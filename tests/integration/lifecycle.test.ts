import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integration tests against a real SQLite database.
 *
 * Each run migrates a throwaway file, so these exercise the actual schema,
 * indexes and constraints rather than a mock. DATABASE_URL is set before the
 * db module is imported, because the client binds to it at module load.
 */

const dir = mkdtempSync(join(tmpdir(), "lifeos-test-"));
process.env.DATABASE_URL = `file:${join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.AUTH_SECRET = "test-secret-value-long-enough-for-hs256-signing";

type Db = typeof import("@/db/connection").db;
type Schema = typeof import("@/db/schema");

let db: Db;
let schema: Schema;
let userId: string;
let drizzle: typeof import("drizzle-orm");

beforeAll(async () => {
  const connection = await import("@/db/connection");
  const migrator = await import("drizzle-orm/libsql/migrator");
  drizzle = await import("drizzle-orm");
  db = connection.db;
  schema = await import("@/db/schema");

  await migrator.migrate(db, { migrationsFolder: "./drizzle" });

  const [user] = await db
    .insert(schema.users)
    .values({ email: "test@example.com", name: "Test", passwordHash: "x" })
    .returning();
  userId = user.id;

  const { provisionUserDefaults } = await import("@/lib/onboarding");
  await provisionUserDefaults(db, userId);
});

afterAll(async () => {
  // Windows keeps the file locked until the client is closed, and a temp
  // directory left behind is not a test failure either way.
  const { client } = await import("@/db/connection");
  client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // The OS will reclaim it.
  }
});

describe("provisioning", () => {
  it("creates the default life areas", async () => {
    const areas = await db
      .select()
      .from(schema.lifeAreas)
      .where(drizzle.eq(schema.lifeAreas.userId, userId));
    expect(areas.length).toBe(9);
    expect(areas.map((a) => a.slug)).toContain("health");
  });

  it("creates notification preferences for both channels", async () => {
    const prefs = await db
      .select()
      .from(schema.notificationPreferences)
      .where(drizzle.eq(schema.notificationPreferences.userId, userId));
    expect(prefs.length).toBe(18);
    // Push defaults are deliberately quiet.
    const financePush = prefs.find((p) => p.category === "finance" && p.channel === "push");
    expect(financePush?.enabled).toBe(false);
  });

  it("is idempotent", async () => {
    const { provisionUserDefaults } = await import("@/lib/onboarding");
    await provisionUserDefaults(db, userId);
    const areas = await db
      .select()
      .from(schema.lifeAreas)
      .where(drizzle.eq(schema.lifeAreas.userId, userId));
    expect(areas.length).toBe(9);
  });
});

describe("task and project lifecycle", () => {
  let projectId: string;

  it("creates a project and computes zero progress with no tasks", async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ userId, title: "Test project", status: "active", lastActivityAt: new Date() })
      .returning();
    projectId = project.id;

    const { computeProgress } = await import("@/lib/domain/projects");
    expect(computeProgress(0, 0)).toBe(0);
  });

  it("counts completion correctly as tasks are finished", async () => {
    await db.insert(schema.tasks).values([
      { userId, projectId, title: "One", status: "todo" },
      { userId, projectId, title: "Two", status: "todo" },
      { userId, projectId, title: "Three", status: "todo" },
    ]);

    const { listProjects, computeProgress } = await import("@/lib/domain/projects");

    let projects = await listProjects(userId, { statuses: ["active"] });
    let target = projects.find((p) => p.id === projectId)!;
    expect(target.taskTotal).toBe(3);
    expect(target.progress).toBe(0);

    await db
      .update(schema.tasks)
      .set({ status: "done", completedAt: new Date() })
      .where(
        drizzle.and(drizzle.eq(schema.tasks.projectId, projectId), drizzle.eq(schema.tasks.title, "One")),
      );

    projects = await listProjects(userId, { statuses: ["active"] });
    target = projects.find((p) => p.id === projectId)!;
    expect(target.taskDone).toBe(1);
    expect(target.progress).toBe(computeProgress(1, 3));
  });

  it("hides soft-deleted tasks from queries but keeps the row", async () => {
    const [task] = await db
      .insert(schema.tasks)
      .values({ userId, projectId, title: "Deleted", status: "todo" })
      .returning();

    await db
      .update(schema.tasks)
      .set({ deletedAt: new Date() })
      .where(drizzle.eq(schema.tasks.id, task.id));

    const { listTasks } = await import("@/lib/domain/tasks");
    const visible = await listTasks(userId, { view: "all" });
    expect(visible.find((t) => t.id === task.id)).toBeUndefined();

    const [stillThere] = await db
      .select()
      .from(schema.tasks)
      .where(drizzle.eq(schema.tasks.id, task.id));
    expect(stillThere).toBeDefined();
  });

  it("marks a project stalled only past the threshold", async () => {
    const { STALL_THRESHOLD_DAYS, listProjects } = await import("@/lib/domain/projects");

    await db
      .update(schema.projects)
      .set({ lastActivityAt: new Date(Date.now() - (STALL_THRESHOLD_DAYS + 5) * 86_400_000) })
      .where(drizzle.eq(schema.projects.id, projectId));

    const stalled = (await listProjects(userId, { statuses: ["active"] })).find(
      (p) => p.id === projectId,
    );
    expect(stalled?.isStalled).toBe(true);

    await db
      .update(schema.projects)
      .set({ lastActivityAt: new Date() })
      .where(drizzle.eq(schema.projects.id, projectId));

    const fresh = (await listProjects(userId, { statuses: ["active"] })).find(
      (p) => p.id === projectId,
    );
    expect(fresh?.isStalled).toBe(false);
  });
});

describe("a project serving several goals", () => {
  it("counts toward both its primary and its extra goals", async () => {
    const [primary] = await db
      .insert(schema.goals)
      .values({ userId, title: "Primary goal" })
      .returning();
    const [secondary] = await db
      .insert(schema.goals)
      .values({ userId, title: "Secondary goal" })
      .returning();

    const [project] = await db
      .insert(schema.projects)
      .values({ userId, title: "Serves two", status: "active", goalId: primary.id })
      .returning();

    await db
      .insert(schema.projectGoals)
      .values({ userId, projectId: project.id, goalId: secondary.id });

    const { listGoals } = await import("@/lib/domain/goals");
    const { listProjects } = await import("@/lib/domain/projects");

    const goalRows = await listGoals(userId, { statuses: ["active"] });
    expect(goalRows.find((g) => g.id === primary.id)?.projectCount).toBe(1);
    // The point of the join table: a supporting goal is not reported as having
    // nothing working on it.
    expect(goalRows.find((g) => g.id === secondary.id)?.projectCount).toBe(1);

    const summary = (await listProjects(userId, { statuses: ["active"] })).find(
      (p) => p.id === project.id,
    );
    expect(summary?.goalTitles).toEqual(["Primary goal", "Secondary goal"]);
  });

  it("does not double count when a goal is both primary and linked", async () => {
    const [goal] = await db
      .insert(schema.goals)
      .values({ userId, title: "Linked twice" })
      .returning();
    const [project] = await db
      .insert(schema.projects)
      .values({ userId, title: "Double link", status: "active", goalId: goal.id })
      .returning();

    await db.insert(schema.projectGoals).values({ userId, projectId: project.id, goalId: goal.id });

    const { listGoals } = await import("@/lib/domain/goals");
    const { listProjects } = await import("@/lib/domain/projects");

    const row = (await listGoals(userId, { statuses: ["active"] })).find((g) => g.id === goal.id);
    expect(row?.projectCount).toBe(1);

    const summary = (await listProjects(userId, { statuses: ["active"] })).find(
      (p) => p.id === project.id,
    );
    expect(summary?.goalTitles).toEqual(["Linked twice"]);
  });
});

describe("integration normalisation", () => {
  it("upserts by provider and external id instead of duplicating", async () => {
    const external = { provider: "demo_provider", externalId: "evt-1" };

    await db.insert(schema.events).values({
      userId,
      title: "Imported event",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 3_600_000),
      origin: "imported",
      ...external,
    });

    // A second sync of the same object must update, not insert.
    await db
      .insert(schema.events)
      .values({
        userId,
        title: "Imported event (renamed)",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        origin: "imported",
        ...external,
      })
      .onConflictDoUpdate({
        target: [schema.events.provider, schema.events.externalId],
        set: { title: "Imported event (renamed)", lastSyncedAt: new Date() },
      });

    const rows = await db
      .select()
      .from(schema.events)
      .where(drizzle.eq(schema.events.externalId, "evt-1"));

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Imported event (renamed)");
    expect(rows[0].origin).toBe("imported");
  });
});

describe("notification engine", () => {
  it("collapses repeat scheduling onto one row via the dedupe key", async () => {
    const { scheduleNotification } = await import("@/lib/notifications/engine");

    await scheduleNotification(userId, {
      category: "tasks",
      type: "task.due",
      title: "First title",
      dedupeKey: "task.due:abc:1440",
    });
    await scheduleNotification(userId, {
      category: "tasks",
      type: "task.due",
      title: "Updated title",
      dedupeKey: "task.due:abc:1440",
    });

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(drizzle.eq(schema.notifications.dedupeKey, "task.due:abc:1440"));

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Updated title");
  });

  it("does not resurrect a notification the user dismissed", async () => {
    const { scheduleNotification } = await import("@/lib/notifications/engine");

    const created = await scheduleNotification(userId, {
      category: "goals",
      type: "goal.neglected",
      title: "Dismissed",
      dedupeKey: "goal.neglected:xyz",
    });

    await db
      .update(schema.notifications)
      .set({ dismissedAt: new Date() })
      .where(drizzle.eq(schema.notifications.id, created.id));

    await scheduleNotification(userId, {
      category: "goals",
      type: "goal.neglected",
      title: "Should not reappear",
      dedupeKey: "goal.neglected:xyz",
    });

    const [row] = await db
      .select()
      .from(schema.notifications)
      .where(drizzle.eq(schema.notifications.dedupeKey, "goal.neglected:xyz"));

    expect(row.title).toBe("Dismissed");
    expect(row.dismissedAt).not.toBeNull();
  });
});

describe("authentication", () => {
  it("stores a bcrypt hash, never the password", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("a-real-password", 12);
    expect(hash).not.toContain("a-real-password");
    expect(await bcrypt.compare("a-real-password", hash)).toBe(true);
    expect(await bcrypt.compare("wrong", hash)).toBe(false);
  });

  it("round-trips a session token and rejects a tampered one", async () => {
    const { signSession, verifySession } = await import("@/lib/auth/session");
    const token = await signSession({ userId: "user-1", email: "a@b.c" });

    expect(await verifySession(token)).toMatchObject({ userId: "user-1", email: "a@b.c" });
    expect(await verifySession(`${token}tampered`)).toBeNull();
    expect(await verifySession("not-a-token")).toBeNull();
  });
});

describe("demo data", () => {
  it("seeds a coherent life and removes cleanly", async () => {
    const { seedDemoData, clearDemoData } = await import("@/lib/demo/seed-demo");

    await seedDemoData(db, userId);

    const demoTasks = await db
      .select()
      .from(schema.tasks)
      .where(drizzle.and(drizzle.eq(schema.tasks.userId, userId), drizzle.eq(schema.tasks.isDemo, true)));
    expect(demoTasks.length).toBeGreaterThan(10);

    // The deliberate signals the dashboard depends on must actually be present.
    const { getStalledProjects } = await import("@/lib/domain/projects");
    expect((await getStalledProjects(userId)).length).toBeGreaterThan(0);

    const { getSpendingAnomalies } = await import("@/lib/domain/finances");
    expect((await getSpendingAnomalies(userId)).length).toBeGreaterThan(0);

    const { getMetricTrend } = await import("@/lib/domain/health");
    const sleep = await getMetricTrend(userId, "sleep_minutes");
    expect(sleep.hasData).toBe(true);
    expect(sleep.direction).toBe("down");

    // Clearing removes demo rows and leaves user-created ones alone.
    const userTaskCountBefore = (
      await db
        .select()
        .from(schema.tasks)
        .where(drizzle.and(drizzle.eq(schema.tasks.userId, userId), drizzle.eq(schema.tasks.isDemo, false)))
    ).length;

    await clearDemoData(db, userId);

    const afterDemo = await db
      .select()
      .from(schema.tasks)
      .where(drizzle.and(drizzle.eq(schema.tasks.userId, userId), drizzle.eq(schema.tasks.isDemo, true)));
    const afterUser = await db
      .select()
      .from(schema.tasks)
      .where(drizzle.and(drizzle.eq(schema.tasks.userId, userId), drizzle.eq(schema.tasks.isDemo, false)));

    expect(afterDemo).toHaveLength(0);
    expect(afterUser.length).toBe(userTaskCountBefore);
  });
});

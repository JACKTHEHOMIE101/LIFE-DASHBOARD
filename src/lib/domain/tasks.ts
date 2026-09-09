import "server-only";

import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { lifeAreas, projects, tasks, type Task, type TaskPriority } from "@/db/schema";
import { addDays, endOfDay, startOfDay, startOfWeek } from "@/lib/utils";

export const OPEN_STATUSES = ["todo", "in_progress", "blocked"] as const;

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  must: "Must do",
  should: "Should do",
  could: "Could do",
};

const PRIORITY_RANK: Record<TaskPriority, number> = { must: 0, should: 1, could: 2 };

/** Shared predicate: alive, and not finished. */
function openTasks(userId: string) {
  return and(
    eq(tasks.userId, userId),
    isNull(tasks.deletedAt),
    inArray(tasks.status, [...OPEN_STATUSES]),
  );
}

export type TaskWithContext = Task & {
  projectTitle: string | null;
  areaName: string | null;
  areaColor: string | null;
};

/** Shape returned by every joined task query in this module. */
type TaskJoinRow = {
  task: Task;
  projectTitle: string | null;
  areaName: string | null;
  areaColor: string | null;
};

function flatten(rows: TaskJoinRow[]): TaskWithContext[] {
  return rows.map((r) => ({
    ...r.task,
    projectTitle: r.projectTitle,
    areaName: r.areaName,
    areaColor: r.areaColor,
  }));
}

/* ---------------------------------------------------------------- queries */

export type TaskFilter = {
  view?: "today" | "upcoming" | "overdue" | "unscheduled" | "completed" | "all";
  projectId?: string;
  lifeAreaId?: string;
  priority?: TaskPriority;
  energy?: "low" | "medium" | "high";
  /** "Show me tasks I can finish in under 20 minutes." */
  maxMinutes?: number;
  search?: string;
  limit?: number;
};

export async function listTasks(userId: string, filter: TaskFilter = {}) {
  const now = new Date();
  const conditions = [eq(tasks.userId, userId), isNull(tasks.deletedAt)];

  switch (filter.view) {
    case "today":
      conditions.push(inArray(tasks.status, [...OPEN_STATUSES]));
      conditions.push(
        or(
          lte(tasks.dueDate, endOfDay(now)),
          and(gte(tasks.scheduledFor, startOfDay(now)), lte(tasks.scheduledFor, endOfDay(now))),
        )!,
      );
      break;
    case "overdue":
      conditions.push(inArray(tasks.status, [...OPEN_STATUSES]));
      conditions.push(lt(tasks.dueDate, startOfDay(now)));
      break;
    case "upcoming":
      conditions.push(inArray(tasks.status, [...OPEN_STATUSES]));
      conditions.push(gte(tasks.dueDate, startOfDay(addDays(now, 1))));
      break;
    case "unscheduled":
      conditions.push(inArray(tasks.status, [...OPEN_STATUSES]));
      conditions.push(isNull(tasks.dueDate));
      break;
    case "completed":
      conditions.push(eq(tasks.status, "done"));
      break;
    default:
      if (filter.view === "all") break;
      conditions.push(inArray(tasks.status, [...OPEN_STATUSES]));
  }

  if (filter.projectId) conditions.push(eq(tasks.projectId, filter.projectId));
  if (filter.lifeAreaId) conditions.push(eq(tasks.lifeAreaId, filter.lifeAreaId));
  if (filter.priority) conditions.push(eq(tasks.priority, filter.priority));
  if (filter.energy) conditions.push(eq(tasks.energy, filter.energy));
  if (filter.maxMinutes) conditions.push(lte(tasks.estimatedMinutes, filter.maxMinutes));
  if (filter.search) {
    conditions.push(sql`lower(${tasks.title}) like ${`%${filter.search.toLowerCase()}%`}`);
  }

  const rows = await db
    .select({
      task: tasks,
      projectTitle: projects.title,
      areaName: lifeAreas.name,
      areaColor: lifeAreas.color,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(lifeAreas, eq(lifeAreas.id, tasks.lifeAreaId))
    .where(and(...conditions))
    .orderBy(
      filter.view === "completed" ? desc(tasks.completedAt) : asc(tasks.dueDate),
      asc(tasks.sortOrder),
    )
    .limit(filter.limit ?? 200);

  return flatten(rows);
}

/**
 * The three to five things the dashboard leads with.
 *
 * Ranking is deliberately simple and explainable: overdue first, then due
 * today, then explicitly scheduled for today, and within each band by declared
 * priority. Nothing here is a learned score, so the order can always be
 * justified to the person reading it.
 */
export async function getTodaysPriorities(userId: string, limit = 5) {
  const now = new Date();
  const rows = await db
    .select({
      task: tasks,
      projectTitle: projects.title,
      areaName: lifeAreas.name,
      areaColor: lifeAreas.color,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(lifeAreas, eq(lifeAreas.id, tasks.lifeAreaId))
    .where(
      and(
        openTasks(userId),
        or(
          lte(tasks.dueDate, endOfDay(now)),
          and(gte(tasks.scheduledFor, startOfDay(now)), lte(tasks.scheduledFor, endOfDay(now))),
        ),
        or(isNull(tasks.snoozedUntil), lte(tasks.snoozedUntil, now)),
      ),
    );

  const startToday = startOfDay(now).getTime();
  return flatten(rows)
    .map((task) => {
      const due = task.dueDate?.getTime();
      const band = due !== undefined && due < startToday ? 0 : due !== undefined ? 1 : 2;
      return { task, band };
    })
    .sort((a, b) =>
      a.band !== b.band
        ? a.band - b.band
        : PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
          (a.task.dueDate?.getTime() ?? 0) - (b.task.dueDate?.getTime() ?? 0),
    )
    .slice(0, limit)
    .map((x) => x.task);
}

export async function getTaskCounts(userId: string) {
  const now = new Date();
  const [openRow] = await db.select({ n: count() }).from(tasks).where(openTasks(userId));
  const [overdueRow] = await db
    .select({ n: count() })
    .from(tasks)
    .where(and(openTasks(userId), lt(tasks.dueDate, startOfDay(now))));
  const [todayRow] = await db
    .select({ n: count() })
    .from(tasks)
    .where(and(openTasks(userId), lte(tasks.dueDate, endOfDay(now)), gte(tasks.dueDate, startOfDay(now))));
  const [doneTodayRow] = await db
    .select({ n: count() })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.status, "done"),
        gte(tasks.completedAt, startOfDay(now)),
      ),
    );

  return {
    open: openRow?.n ?? 0,
    overdue: overdueRow?.n ?? 0,
    dueToday: todayRow?.n ?? 0,
    completedToday: doneTodayRow?.n ?? 0,
  };
}

/** Daily completion counts for the last `days` days, oldest first. */
export async function getCompletionSeries(userId: string, days = 14) {
  const since = startOfDay(addDays(new Date(), -(days - 1)));
  const rows = await db
    .select({
      day: sql<string>`date(${tasks.completedAt} / 1000, 'unixepoch', 'localtime')`,
      n: count(),
    })
    .from(tasks)
    .where(
      and(eq(tasks.userId, userId), eq(tasks.status, "done"), gte(tasks.completedAt, since)),
    )
    .groupBy(sql`1`);

  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(since, i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date, label: key, value: byDay.get(key) ?? 0 };
  });
}

export async function getTaskById(userId: string, taskId: string) {
  const rows = await db
    .select({
      task: tasks,
      projectTitle: projects.title,
      areaName: lifeAreas.name,
      areaColor: lifeAreas.color,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(lifeAreas, eq(lifeAreas.id, tasks.lifeAreaId))
    .where(and(eq(tasks.userId, userId), eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  return flatten(rows)[0] ?? null;
}

/** Open tasks that fit a window, for "what can I do in 20 minutes?". */
export async function getTasksFittingWindow(userId: string, minutes: number, limit = 10) {
  const rows = await db
    .select({
      task: tasks,
      projectTitle: projects.title,
      areaName: lifeAreas.name,
      areaColor: lifeAreas.color,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(lifeAreas, eq(lifeAreas.id, tasks.lifeAreaId))
    .where(and(openTasks(userId), lte(tasks.estimatedMinutes, minutes), ne(tasks.status, "blocked")))
    .orderBy(asc(tasks.dueDate), asc(tasks.estimatedMinutes))
    .limit(limit);
  return flatten(rows);
}

export async function getWeeklyCompletedTasks(userId: string, weekStartsOn = 1) {
  const start = startOfWeek(new Date(), weekStartsOn);
  return db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.userId, userId), eq(tasks.status, "done"), gte(tasks.completedAt, start)),
    )
    .orderBy(desc(tasks.completedAt));
}

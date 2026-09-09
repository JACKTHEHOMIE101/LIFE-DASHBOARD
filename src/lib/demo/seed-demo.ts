import { and, eq, inArray } from "drizzle-orm";
import type { db as Db } from "@/db/connection";
import {
  events,
  exerciseSets,
  exercises,
  financialAccounts,
  goals,
  habitEntries,
  habits,
  interactions,
  journalEntries,
  lifeAreas,
  metrics,
  milestones,
  notes,
  people,
  projects,
  tasks,
  transactions,
  userSettings,
  workouts,
} from "@/db/schema";

type Database = typeof Db;

/* ------------------------------------------------------------------ helpers */

/** Seeded PRNG so the demo dataset is identical on every machine and rerun. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Days from today; negative is the past. */
function day(offset: number, hour = 0, minute = 0) {
  const d = new Date(startOfToday().getTime() + offset * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function round(n: number, places = 1) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

const demo = { isDemo: true as const };

/* -------------------------------------------------------------------- seed */

/**
 * Builds a full, internally consistent demo life: projects that reference real
 * goals, tasks that roll up to those projects, a calendar that matches the
 * tasks, and health/finance histories with deliberate signals in them (a
 * stalled project, a sleep dip, a dining overspend, a neglected friend) so the
 * Attention and Chief of Staff features have something true to find.
 *
 * Every row is flagged `isDemo` and is labelled as such throughout the UI.
 */
export async function seedDemoData(database: Database, userId: string) {
  const rand = rng(20260909);
  const areas = await database.select().from(lifeAreas).where(eq(lifeAreas.userId, userId));
  const area = (slug: string) => areas.find((a) => a.slug === slug)?.id ?? null;

  /* --------------------------------------------------------------- goals */

  const goalRows = await database
    .insert(goals)
    .values([
      {
        userId,
        lifeAreaId: area("career"),
        title: "Become a principal engineer",
        why: "I want the scope to shape technical direction, not just execute it.",
        description: "Lead one company-wide initiative and mentor two engineers.",
        targetDate: day(320),
        metricName: "Initiatives led",
        metricUnit: "initiatives",
        startValue: 0,
        currentValue: 1,
        targetValue: 3,
        lastProgressAt: day(-6),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("money"),
        title: "Reach $250k net worth",
        why: "A two-year runway turns career risk into a choice rather than a threat.",
        targetDate: day(430),
        metricName: "Net worth",
        metricUnit: "USD",
        startValue: 108_000,
        currentValue: 179_400,
        targetValue: 250_000,
        lastProgressAt: day(-2),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("health"),
        title: "Run a half marathon under 1:50",
        why: "I want a concrete reason to keep training through winter.",
        targetDate: day(154),
        metricName: "Longest run",
        metricUnit: "km",
        startValue: 8,
        currentValue: 16.5,
        targetValue: 21.1,
        lastProgressAt: day(-4),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("personal-growth"),
        title: "Hold a 30 minute conversation in Spanish",
        why: "We are moving to Madrid for a year and I refuse to arrive helpless.",
        targetDate: day(240),
        metricName: "Conversation length",
        metricUnit: "minutes",
        startValue: 0,
        currentValue: 6,
        targetValue: 30,
        // Deliberately stale: this is the goal the Attention panel should flag.
        lastProgressAt: day(-23),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("relationships"),
        title: "See close friends twice a month",
        why: "Left alone, months disappear and I only notice afterwards.",
        targetDate: day(200),
        metricName: "Meetups per month",
        metricUnit: "meetups",
        startValue: 0,
        currentValue: 1,
        targetValue: 2,
        lastProgressAt: day(-9),
        ...demo,
      },
    ])
    .returning();

  const goal = (title: string) => goalRows.find((g) => g.title.startsWith(title))?.id ?? null;

  /* ------------------------------------------------------------ projects */

  const projectRows = await database
    .insert(projects)
    .values([
      {
        userId,
        lifeAreaId: area("career"),
        goalId: goal("Become a principal"),
        title: "Q3 platform proposal",
        objective: "Get funding approved for the platform consolidation work.",
        description: "Written proposal, cost model, and a review with the leadership group.",
        status: "active",
        deadline: day(4),
        startedAt: day(-26),
        lastActivityAt: day(-1),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("career"),
        goalId: goal("Become a principal"),
        title: "Mentoring programme",
        objective: "Run a structured mentoring loop with two engineers.",
        status: "active",
        deadline: day(60),
        startedAt: day(-52),
        lastActivityAt: day(-7),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("home"),
        title: "Kitchen renovation",
        objective: "Finish the kitchen before the winter holidays.",
        status: "active",
        deadline: day(75),
        startedAt: day(-40),
        // No activity for 19 days: the stalled-project signal.
        lastActivityAt: day(-19),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("health"),
        goalId: goal("Run a half"),
        title: "Half marathon training block",
        objective: "Twelve week build to race day.",
        status: "active",
        deadline: day(154),
        startedAt: day(-30),
        lastActivityAt: day(-1),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("personal-growth"),
        goalId: goal("Hold a 30 minute"),
        title: "Spanish before Madrid",
        objective: "Daily practice plus a weekly tutor session.",
        status: "active",
        deadline: day(240),
        startedAt: day(-70),
        lastActivityAt: day(-23),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("money"),
        goalId: goal("Reach $250k"),
        title: "Rebuild the budget",
        objective: "Get the savings rate back above 30 percent.",
        status: "active",
        deadline: day(21),
        startedAt: day(-14),
        lastActivityAt: day(-3),
        ...demo,
      },
      {
        userId,
        lifeAreaId: area("experiences"),
        title: "Madrid relocation research",
        objective: "Understand visas, neighbourhoods and cost of living.",
        status: "planning",
        startedAt: day(-11),
        lastActivityAt: day(-11),
        ...demo,
      },
    ])
    .returning();

  const project = (title: string) => projectRows.find((p) => p.title.startsWith(title))!;

  await database.insert(milestones).values([
    { userId, projectId: project("Q3 platform").id, title: "Draft circulated for comment", dueDate: day(-3), completedAt: day(-3), sortOrder: 0, ...demo },
    { userId, projectId: project("Q3 platform").id, title: "Cost model reviewed by finance", dueDate: day(1), sortOrder: 1, ...demo },
    { userId, projectId: project("Q3 platform").id, title: "Leadership sign-off", dueDate: day(4), sortOrder: 2, ...demo },
    { userId, projectId: project("Kitchen").id, title: "Contractor quotes collected", dueDate: day(-8), completedAt: day(-21), sortOrder: 0, ...demo },
    { userId, projectId: project("Kitchen").id, title: "Cabinets ordered", dueDate: day(9), sortOrder: 1, ...demo },
    { userId, projectId: project("Half marathon").id, title: "Longest run of 18km", dueDate: day(35), sortOrder: 0, ...demo },
  ]);

  /* --------------------------------------------------------------- tasks */

  type SeedTask = {
    title: string;
    project?: string;
    areaSlug?: string;
    priority: "must" | "should" | "could";
    status?: "todo" | "in_progress" | "done";
    dueOffset?: number;
    estimatedMinutes?: number;
    energy?: "low" | "medium" | "high";
    tags?: string[];
    completedOffset?: number;
  };

  const seedTasks: SeedTask[] = [
    { title: "Finish the Q3 platform proposal", project: "Q3 platform", priority: "must", status: "in_progress", dueOffset: 0, estimatedMinutes: 90, energy: "high", tags: ["writing"] },
    { title: "Send the cost model to finance", project: "Q3 platform", priority: "must", dueOffset: 0, estimatedMinutes: 25, energy: "medium" },
    { title: "Half marathon long run", project: "Half marathon", areaSlug: "health", priority: "must", dueOffset: 0, estimatedMinutes: 75, energy: "high", tags: ["training"] },
    { title: "Call John back", areaSlug: "relationships", priority: "should", dueOffset: 0, estimatedMinutes: 15, energy: "low" },
    { title: "Reconcile last month in the budget", project: "Rebuild the budget", priority: "should", dueOffset: 1, estimatedMinutes: 40, energy: "medium" },
    { title: "Book the mentoring session with Priya", project: "Mentoring", priority: "should", dueOffset: 1, estimatedMinutes: 10, energy: "low" },
    { title: "Order the kitchen cabinets", project: "Kitchen", priority: "must", dueOffset: 2, estimatedMinutes: 45, energy: "medium" },
    { title: "Review the visa requirements for Spain", project: "Madrid relocation", priority: "could", dueOffset: 5, estimatedMinutes: 60, energy: "medium" },
    { title: "Draft the mentoring curriculum", project: "Mentoring", priority: "should", dueOffset: 6, estimatedMinutes: 120, energy: "high" },
    { title: "Cancel the unused subscriptions", project: "Rebuild the budget", priority: "could", dueOffset: 8, estimatedMinutes: 20, energy: "low" },
    { title: "Book a physio appointment", areaSlug: "health", priority: "should", dueOffset: 3, estimatedMinutes: 10, energy: "low" },
    { title: "Plan the Madrid scouting trip", project: "Madrid relocation", priority: "could", dueOffset: 14, estimatedMinutes: 90, energy: "medium" },
    { title: "Write up the architecture review notes", project: "Q3 platform", priority: "should", dueOffset: -2, estimatedMinutes: 45, energy: "medium" },
    { title: "Chase the contractor for a start date", project: "Kitchen", priority: "must", dueOffset: -4, estimatedMinutes: 15, energy: "low" },
    { title: "Renew the passport", areaSlug: "other", priority: "must", dueOffset: -1, estimatedMinutes: 60, energy: "medium" },
    { title: "Spanish lesson with the tutor", project: "Spanish", priority: "should", dueOffset: -6, estimatedMinutes: 60, energy: "medium" },
  ];

  const completed: SeedTask[] = [
    { title: "Circulate the proposal draft", project: "Q3 platform", priority: "must", status: "done", completedOffset: -3, estimatedMinutes: 60 },
    { title: "Interval session", project: "Half marathon", priority: "should", status: "done", completedOffset: -1, estimatedMinutes: 45 },
    { title: "Weekly budget check", project: "Rebuild the budget", priority: "should", status: "done", completedOffset: -3, estimatedMinutes: 30 },
    { title: "Collect contractor quotes", project: "Kitchen", priority: "must", status: "done", completedOffset: -21, estimatedMinutes: 90 },
    { title: "Mentoring intro session", project: "Mentoring", priority: "should", status: "done", completedOffset: -7, estimatedMinutes: 60 },
    { title: "Easy 8km run", project: "Half marathon", priority: "could", status: "done", completedOffset: -4, estimatedMinutes: 50 },
    { title: "Set up the investment transfer", project: "Rebuild the budget", priority: "must", status: "done", completedOffset: -6, estimatedMinutes: 25 },
    { title: "Book the tutor for the month", project: "Spanish", priority: "should", status: "done", completedOffset: -23, estimatedMinutes: 15 },
    { title: "Draft the platform cost assumptions", project: "Q3 platform", priority: "should", status: "done", completedOffset: -5, estimatedMinutes: 75 },
    { title: "Tempo run", project: "Half marathon", priority: "should", status: "done", completedOffset: -8, estimatedMinutes: 40 },
    { title: "Review the family calendar", areaSlug: "family", priority: "could", status: "done", completedOffset: -9, estimatedMinutes: 15 },
    { title: "Pay the quarterly tax estimate", areaSlug: "money", priority: "must", status: "done", completedOffset: -12, estimatedMinutes: 45 },
  ];

  await database.insert(tasks).values(
    [...seedTasks, ...completed].map((t, index) => {
      const p = t.project ? project(t.project) : null;
      return {
        userId,
        projectId: p?.id ?? null,
        lifeAreaId: p?.lifeAreaId ?? (t.areaSlug ? area(t.areaSlug) : null),
        goalId: p?.goalId ?? null,
        title: t.title,
        status: t.status ?? "todo",
        priority: t.priority,
        dueDate: t.dueOffset !== undefined ? day(t.dueOffset, 17) : null,
        estimatedMinutes: t.estimatedMinutes ?? null,
        actualMinutes: t.status === "done" ? Math.round((t.estimatedMinutes ?? 30) * (0.7 + rand() * 0.8)) : null,
        energy: t.energy ?? "medium",
        tags: t.tags ?? [],
        completedAt: t.completedOffset !== undefined ? day(t.completedOffset, 16) : null,
        sortOrder: index,
        ...demo,
      };
    }),
  );

  /* -------------------------------------------------------------- people */

  const peopleRows = await database
    .insert(people)
    .values([
      { userId, name: "John Alvarez", relationshipType: "close friend", importance: 1, cadenceDays: 14, lastInteractionAt: day(-28), interests: ["cycling", "film"], notes: "Moving jobs soon, wants to talk it through.", birthday: day(41), ...demo },
      { userId, name: "Priya Raman", relationshipType: "mentee", importance: 2, cadenceDays: 14, lastInteractionAt: day(-7), interests: ["distributed systems"], ...demo },
      { userId, name: "Mum", relationshipType: "family", importance: 1, cadenceDays: 7, lastInteractionAt: day(-3), birthday: day(96), ...demo },
      { userId, name: "Daniel Okafor", relationshipType: "close friend", importance: 1, cadenceDays: 21, lastInteractionAt: day(-9), interests: ["running", "cooking"], ...demo },
      { userId, name: "Sofia Marchetti", relationshipType: "friend", importance: 3, cadenceDays: 45, lastInteractionAt: day(-38), interests: ["travel"], notes: "Lived in Madrid for three years.", ...demo },
      { userId, name: "Tom Bradley", relationshipType: "colleague", importance: 3, cadenceDays: 30, lastInteractionAt: day(-4), ...demo },
      { userId, name: "Aunt Carol", relationshipType: "family", importance: 2, cadenceDays: 30, lastInteractionAt: day(-19), birthday: day(12), ...demo },
      { userId, name: "Marcus Lee", relationshipType: "colleague", importance: 4, cadenceDays: 60, lastInteractionAt: day(-15), ...demo },
    ])
    .returning();

  const person = (name: string) => peopleRows.find((p) => p.name.startsWith(name))!.id;

  await database.insert(interactions).values([
    { userId, personId: person("Mum"), type: "call", occurredAt: day(-3, 19), notes: "Sunday call. She is planning the holiday visit.", ...demo },
    { userId, personId: person("Priya"), type: "meeting", occurredAt: day(-7, 11), notes: "First mentoring session. Agreed on a systems design focus.", ...demo },
    { userId, personId: person("Daniel"), type: "meetup", occurredAt: day(-9, 20), notes: "Dinner. He is in for the half marathon.", ...demo },
    { userId, personId: person("John"), type: "call", occurredAt: day(-28, 18), notes: "Long catch-up about the job move.", ...demo },
    { userId, personId: person("Tom"), type: "message", occurredAt: day(-4, 10), ...demo },
    { userId, personId: person("Aunt Carol"), type: "call", occurredAt: day(-19, 15), ...demo },
  ]);

  /* ------------------------------------------------------------- habits */

  const habitRows = await database
    .insert(habits)
    .values([
      { userId, lifeAreaId: area("health"), goalId: goal("Run a half"), name: "Move for 30 minutes", frequency: "daily", targetPerPeriod: 1, color: "rose", ...demo },
      { userId, lifeAreaId: area("personal-growth"), goalId: goal("Hold a 30 minute"), name: "Spanish practice", frequency: "daily", targetPerPeriod: 1, color: "violet", ...demo },
      { userId, lifeAreaId: area("health"), name: "Lights out by 23:00", frequency: "daily", targetPerPeriod: 1, color: "indigo", ...demo },
      { userId, lifeAreaId: area("personal-growth"), name: "Read 20 pages", frequency: "daily", targetPerPeriod: 1, color: "amber", ...demo },
      { userId, lifeAreaId: area("career"), name: "Weekly review", frequency: "weekly", targetPerPeriod: 1, color: "emerald", ...demo },
    ])
    .returning();

  const entries: (typeof habitEntries.$inferInsert)[] = [];
  for (const habit of habitRows) {
    // Each habit gets its own adherence rate, and Spanish deliberately drops
    // off three weeks ago to match its stalled goal and project.
    const base = habit.name.startsWith("Spanish") ? 0.85 : habit.name.startsWith("Read") ? 0.55 : 0.78;
    for (let offset = -74; offset <= 0; offset += habit.frequency === "weekly" ? 7 : 1) {
      const stalled = habit.name.startsWith("Spanish") && offset > -23;
      const chance = stalled ? 0.05 : base;
      if (rand() < chance) {
        entries.push({ userId, habitId: habit.id, date: isoDate(day(offset)), completed: true, ...demo });
      }
    }
  }
  await database.insert(habitEntries).values(entries);

  /* --------------------------------------------------------- health data */

  const metricRows: (typeof metrics.$inferInsert)[] = [];
  for (let offset = -89; offset <= 0; offset++) {
    const d = isoDate(day(offset));
    // Sleep is normal for months, then drops for the last twelve days. That dip
    // is the trend the health panel and the Chief of Staff should surface.
    const dip = offset > -12 ? -42 : 0;
    const sleep = 447 + dip + (rand() - 0.5) * 55;
    metricRows.push(
      { userId, kind: "sleep_minutes", date: d, value: Math.round(sleep), unit: "minutes", provider: "demo", origin: "imported", ...demo },
      { userId, kind: "resting_heart_rate", date: d, value: Math.round(53 + (dip ? 3 : 0) + (rand() - 0.5) * 4), unit: "bpm", provider: "demo", origin: "imported", ...demo },
      { userId, kind: "hrv", date: d, value: Math.round(62 + (dip ? -7 : 0) + (rand() - 0.5) * 12), unit: "ms", provider: "demo", origin: "imported", ...demo },
      { userId, kind: "steps", date: d, value: Math.round(7400 + (rand() - 0.4) * 5200), unit: "steps", provider: "demo", origin: "imported", ...demo },
      { userId, kind: "weight_kg", date: d, value: round(78.4 - offset * -0.012 + (rand() - 0.5) * 0.5, 1), unit: "kg", provider: "demo", origin: "imported", ...demo },
    );
  }
  await database.insert(metrics).values(metricRows);

  /* ------------------------------------------------------------ workouts */

  const workoutPlan = [
    { offset: -1, name: "Interval session", type: "run", minutes: 45, distance: 8200 },
    { offset: -4, name: "Easy run", type: "run", minutes: 50, distance: 8000 },
    { offset: -6, name: "Upper body", type: "strength", minutes: 55 },
    { offset: -8, name: "Tempo run", type: "run", minutes: 40, distance: 7400 },
    { offset: -11, name: "Long run", type: "run", minutes: 96, distance: 16500 },
    { offset: -13, name: "Lower body", type: "strength", minutes: 60 },
    { offset: -18, name: "Easy run", type: "run", minutes: 42, distance: 6800 },
    { offset: -20, name: "Upper body", type: "strength", minutes: 52 },
    { offset: -25, name: "Long run", type: "run", minutes: 88, distance: 15000 },
    { offset: -27, name: "Lower body", type: "strength", minutes: 58 },
    { offset: -33, name: "Easy run", type: "run", minutes: 38, distance: 6200 },
    { offset: -35, name: "Upper body", type: "strength", minutes: 50 },
  ];

  const workoutRows = await database
    .insert(workouts)
    .values(
      workoutPlan.map((w) => ({
        userId,
        name: w.name,
        type: w.type,
        startedAt: day(w.offset, 7, 15),
        durationMinutes: w.minutes,
        distanceMeters: w.distance ?? null,
        calories: Math.round(w.minutes * (w.type === "run" ? 11.5 : 7.5)),
        avgHeartRate: w.type === "run" ? 152 : 118,
        provider: "demo",
        origin: "imported" as const,
        ...demo,
      })),
    )
    .returning();

  const strengthWorkouts = workoutRows.filter((w) => w.type === "strength");
  const exerciseRows = await database
    .insert(exercises)
    .values(
      strengthWorkouts.flatMap((w, i) => {
        const names = w.name === "Upper body"
          ? ["Bench press", "Pull-up", "Overhead press"]
          : ["Back squat", "Romanian deadlift", "Split squat"];
        return names.map((name, order) => ({ userId, workoutId: w.id, name, sortOrder: order + i * 0 }));
      }),
    )
    .returning();

  await database.insert(exerciseSets).values(
    exerciseRows.flatMap((ex) => {
      const baseWeight =
        ex.name === "Bench press" ? 72 : ex.name === "Back squat" ? 95 :
        ex.name === "Romanian deadlift" ? 85 : ex.name === "Overhead press" ? 45 :
        ex.name === "Split squat" ? 30 : 0;
      return [1, 2, 3].map((setNumber) => ({
        userId,
        exerciseId: ex.id,
        setNumber,
        reps: ex.name === "Pull-up" ? 8 - setNumber : 8,
        weightKg: baseWeight ? round(baseWeight + setNumber * 2.5, 1) : null,
      }));
    }),
  );

  /* ------------------------------------------------------------ finances */

  const accountRows = await database
    .insert(financialAccounts)
    .values([
      { userId, name: "Everyday checking", institution: "Demo Bank", type: "checking", balanceMinor: 842_300, ...demo },
      { userId, name: "Emergency savings", institution: "Demo Bank", type: "savings", balanceMinor: 2_410_000, ...demo },
      { userId, name: "Brokerage", institution: "Demo Invest", type: "investment", balanceMinor: 6_128_000, ...demo },
      { userId, name: "Retirement", institution: "Demo Invest", type: "retirement", balanceMinor: 8_874_000, ...demo },
      { userId, name: "Credit card", institution: "Demo Bank", type: "credit", balanceMinor: 243_800, isLiability: true, ...demo },
      { userId, name: "Car loan", institution: "Demo Finance", type: "loan", balanceMinor: 312_000, isLiability: true, ...demo },
    ])
    .returning();

  const checking = accountRows.find((a) => a.type === "checking")!.id;
  const card = accountRows.find((a) => a.type === "credit")!.id;

  const recurring = [
    { description: "Salary", merchant: "Acme Corp", amountMinor: 612_000, category: "income", account: checking, dayOfMonth: 25 },
    { description: "Rent", merchant: "Landlord", amountMinor: -185_000, category: "housing", account: checking, dayOfMonth: 1 },
    { description: "Utilities", merchant: "City Energy", amountMinor: -14_200, category: "utilities", account: checking, dayOfMonth: 4 },
    { description: "Phone", merchant: "Telco", amountMinor: -4_500, category: "utilities", account: card, dayOfMonth: 8 },
    { description: "Gym membership", merchant: "Iron Works", amountMinor: -6_900, category: "health", account: card, dayOfMonth: 6 },
    { description: "Streaming", merchant: "Streamly", amountMinor: -1_899, category: "entertainment", account: card, dayOfMonth: 14 },
    { description: "Investment transfer", merchant: "Demo Invest", amountMinor: -150_000, category: "savings", account: checking, dayOfMonth: 26 },
  ];

  const variable = [
    { merchant: "Corner Grocer", category: "groceries", min: 2_200, max: 9_800 },
    { merchant: "Bella Cucina", category: "dining", min: 3_400, max: 12_500 },
    { merchant: "Daily Grind", category: "dining", min: 450, max: 1_400 },
    { merchant: "Metro Transit", category: "transport", min: 280, max: 1_100 },
    { merchant: "Bookshop", category: "personal_growth", min: 1_200, max: 4_500 },
    { merchant: "Pharmacy", category: "health", min: 800, max: 3_600 },
    { merchant: "Hardware Depot", category: "home", min: 2_500, max: 18_000 },
  ];

  const txRows: (typeof transactions.$inferInsert)[] = [];
  for (let offset = -119; offset <= 0; offset++) {
    const d = day(offset);
    for (const r of recurring) {
      if (d.getDate() === r.dayOfMonth) {
        txRows.push({
          userId, accountId: r.account, date: isoDate(d), description: r.description,
          merchant: r.merchant, amountMinor: r.amountMinor, category: r.category,
          isRecurring: true, provider: "demo", origin: "imported", ...demo,
        });
      }
    }
    // Two to four discretionary purchases a day, with dining running hot for
    // the last month so the anomaly detector has a real pattern to report.
    const count = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const v = variable[Math.floor(rand() * variable.length)];
      const inflation = v.category === "dining" && offset > -30 ? 1.35 : 1;
      const amount = Math.round((v.min + rand() * (v.max - v.min)) * inflation);
      txRows.push({
        userId, accountId: rand() > 0.4 ? card : checking, date: isoDate(d),
        description: v.merchant, merchant: v.merchant, amountMinor: -amount,
        category: v.category, provider: "demo", origin: "imported", ...demo,
      });
    }
  }
  await database.insert(transactions).values(txRows);

  /* ------------------------------------------------------------ calendar */

  const eventRows: (typeof events.$inferInsert)[] = [];
  for (let offset = -14; offset <= 21; offset++) {
    const d = day(offset);
    const weekday = d.getDay();
    if (weekday === 0 || weekday === 6) {
      if (weekday === 6 && rand() > 0.4) {
        eventRows.push({
          userId, title: "Long run", startsAt: day(offset, 8), endsAt: day(offset, 9, 40),
          category: "health", calendarName: "Personal", provider: "demo", origin: "imported", ...demo,
        });
      }
      if (weekday === 0 && rand() > 0.5) {
        eventRows.push({
          userId, title: "Sunday call with Mum", startsAt: day(offset, 19), endsAt: day(offset, 19, 40),
          category: "social", calendarName: "Personal", provider: "demo", origin: "imported", ...demo,
        });
      }
      continue;
    }

    eventRows.push({
      userId, title: "Team standup", startsAt: day(offset, 9, 30), endsAt: day(offset, 9, 45),
      category: "meeting", calendarName: "Work", attendees: [{ name: "Team" }],
      provider: "demo", origin: "imported", ...demo,
    });

    // Wednesdays are deliberately overloaded so the calendar analytics have a
    // fragmented, meeting-heavy day to point at.
    const meetingCount = weekday === 3 ? 5 : Math.floor(rand() * 3);
    const titles = ["Design review", "1:1 with Tom", "Platform sync", "Roadmap check-in", "Vendor call", "Hiring debrief"];
    for (let i = 0; i < meetingCount; i++) {
      const hour = 11 + i * 1.5;
      eventRows.push({
        userId, title: titles[Math.floor(rand() * titles.length)],
        startsAt: day(offset, Math.floor(hour), (hour % 1) * 60),
        endsAt: day(offset, Math.floor(hour), (hour % 1) * 60 + 45),
        category: "meeting", calendarName: "Work",
        attendees: [{ name: "Tom Bradley" }, { name: "Priya Raman" }],
        provider: "demo", origin: "imported", ...demo,
      });
    }

    if (weekday !== 3) {
      eventRows.push({
        userId, title: "Focus block", startsAt: day(offset, 14), endsAt: day(offset, 16),
        category: "focus", calendarName: "Work", provider: "demo", origin: "imported", ...demo,
      });
    }
    if (weekday === 2 || weekday === 4) {
      eventRows.push({
        userId, title: "Gym", startsAt: day(offset, 18), endsAt: day(offset, 19, 15),
        category: "health", calendarName: "Personal", provider: "demo", origin: "imported", ...demo,
      });
    }
    if (weekday === 1) {
      eventRows.push({
        userId, title: "Spanish tutor", startsAt: day(offset, 20), endsAt: day(offset, 21),
        category: "personal", calendarName: "Personal", provider: "demo", origin: "imported", ...demo,
      });
    }
  }
  eventRows.push({
    userId, title: "Leadership review: platform proposal",
    startsAt: day(4, 15), endsAt: day(4, 16), category: "meeting", location: "Boardroom",
    calendarName: "Work", attendees: [{ name: "Leadership group" }],
    projectId: project("Q3 platform").id, provider: "demo", origin: "imported", ...demo,
  });
  await database.insert(events).values(eventRows);

  /* ------------------------------------------------------------- journal */

  const journalSeeds = [
    { offset: -1, mood: 3, energy: 3, productivity: 4, wins: "Got the cost model into a shape I am not embarrassed by.", challenges: "Slept badly again. Third night this week.", gratitude: "Daniel offering to pace me on the long run.", tomorrowPriority: "Finish the proposal." },
    { offset: -2, mood: 4, energy: 3, productivity: 3, wins: "Good interval session before work.", challenges: "Wednesday was five meetings deep, nothing else happened.", gratitude: "A quiet evening.", tomorrowPriority: "Cost model." },
    { offset: -3, mood: 4, energy: 4, productivity: 4, wins: "Draft circulated. Relief.", challenges: "Kitchen project is drifting and I keep avoiding the contractor.", gratitude: "Mum called.", tomorrowPriority: "Chase the contractor." },
    { offset: -5, mood: 3, energy: 2, productivity: 2, wins: "Rested deliberately.", challenges: "Low energy all day.", gratitude: "Nothing urgent broke.", tomorrowPriority: "Easy run." },
    { offset: -7, mood: 4, energy: 4, productivity: 4, wins: "First mentoring session with Priya went well.", challenges: "Spanish has quietly stopped happening.", gratitude: "Being asked to mentor at all.", tomorrowPriority: "Restart Spanish." },
    { offset: -9, mood: 5, energy: 4, productivity: 3, wins: "Dinner with Daniel. Laughed properly for the first time in a while.", challenges: "Spent more than I meant to.", gratitude: "Old friends.", tomorrowPriority: "Budget review." },
    { offset: -12, mood: 3, energy: 3, productivity: 4, wins: "Taxes paid, off my mind.", challenges: "Still no movement on the kitchen.", gratitude: "A clear afternoon.", tomorrowPriority: "Cabinets." },
    { offset: -14, mood: 4, energy: 4, productivity: 5, wins: "Best focus block in weeks.", challenges: "None worth noting.", gratitude: "Quiet office.", tomorrowPriority: "Keep the momentum." },
    { offset: -18, mood: 3, energy: 3, productivity: 3, wins: "Steady day.", challenges: "Too much context switching.", gratitude: "Coffee.", tomorrowPriority: "Fewer meetings." },
    { offset: -21, mood: 4, energy: 4, productivity: 4, wins: "Long run felt easy.", challenges: "Ate badly afterwards.", gratitude: "Legs that still work.", tomorrowPriority: "Groceries." },
  ];
  await database.insert(journalEntries).values(
    journalSeeds.map((j) => ({
      userId, date: isoDate(day(j.offset)), mood: j.mood, energy: j.energy,
      productivity: j.productivity, wins: j.wins, challenges: j.challenges,
      gratitude: j.gratitude, tomorrowPriority: j.tomorrowPriority, ...demo,
    })),
  );

  /* --------------------------------------------------------------- notes */

  await database.insert(notes).values([
    { userId, title: "Platform proposal: core argument", type: "note", lifeAreaId: area("career"), projectId: project("Q3 platform").id, tags: ["proposal"], body: "Three services solve the same problem three ways. The cost is not the infrastructure, it is the coordination tax on every change that touches more than one of them.", ...demo },
    { userId, title: "Leadership review prep", type: "meeting", projectId: project("Q3 platform").id, tags: ["meeting"], body: "Expect pushback on the migration timeline. Have the incremental path ready: consolidate reads first, writes later.", ...demo },
    { userId, title: "Madrid neighbourhoods", type: "note", lifeAreaId: area("experiences"), projectId: project("Madrid relocation").id, tags: ["madrid"], body: "Sofia recommends Chamberi over Malasana for a longer stay. Quieter, better for actually living there.", ...demo },
    { userId, title: "Idea: write about platform consolidation", type: "idea", lifeAreaId: area("career"), tags: ["writing"], body: "The proposal work would make a decent essay once it lands.", ...demo },
    { userId, title: "Half marathon plan notes", type: "note", lifeAreaId: area("health"), projectId: project("Half marathon").id, body: "Build to 18km by week nine, then taper. Keep easy runs genuinely easy.", ...demo },
    { userId, title: "Spanish: verbs I keep getting wrong", type: "note", lifeAreaId: area("personal-growth"), tags: ["spanish"], body: "Ser vs estar with conditions. Preterite vs imperfect for interrupted actions.", ...demo },
    { userId, title: "Kitchen: contractor quotes", type: "document", projectId: project("Kitchen").id, body: "Three quotes collected. Middle one is the best value but the start date keeps slipping.", ...demo },
    { userId, title: "Mentoring curriculum sketch", type: "note", projectId: project("Mentoring").id, body: "Six sessions: systems design, code review, incident response, writing, influence, career shape.", ...demo },
    { userId, title: "Budget rebuild principles", type: "note", projectId: project("Rebuild the budget").id, body: "Automate the savings transfer first, then let the rest be discretionary. Willpower is not a budget.", ...demo },
    { userId, title: "Article: sleep and cognitive load", type: "bookmark", url: "https://example.com/sleep-and-focus", lifeAreaId: area("health"), body: "Saved for later.", ...demo },
  ]);

  await database
    .update(userSettings)
    .set({ demoDataPresent: true })
    .where(eq(userSettings.userId, userId));
}

/** Removes every demo row, leaving anything the user created untouched. */
export async function clearDemoData(database: Database, userId: string) {
  // Children first: exercises and sets hang off workouts and carry no demo flag
  // of their own, so they are scoped through the demo workouts that own them.
  const demoWorkoutIds = database
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.isDemo, true)));

  const demoExerciseIds = database
    .select({ id: exercises.id })
    .from(exercises)
    .where(inArray(exercises.workoutId, demoWorkoutIds));

  await database.delete(exerciseSets).where(inArray(exerciseSets.exerciseId, demoExerciseIds));
  await database.delete(exercises).where(inArray(exercises.workoutId, demoWorkoutIds));

  const flagged = [
    workouts, metrics, transactions, financialAccounts, interactions, people,
    habitEntries, habits, journalEntries, notes, events, tasks, milestones,
    projects, goals,
  ] as const;

  for (const table of flagged) {
    await database.delete(table).where(and(eq(table.userId, userId), eq(table.isDemo, true)));
  }

  await database
    .update(userSettings)
    .set({ demoDataPresent: false })
    .where(eq(userSettings.userId, userId));
}

import "server-only";

import { and, count, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { habitEntries, journalEntries, tasks } from "@/db/schema";
import { addDays, formatDuration, formatMoney, isoDate, mean, pct, startOfWeek } from "@/lib/utils";
import { analyseEvents, getEventsBetween } from "./calendar";
import { getCashflowForRange, getSpendingAnomalies } from "./finances";
import { listGoals } from "./goals";
import { getMetricTrend, getWorkoutStats } from "./health";
import { listProjects } from "./projects";
import { getTimeAnalytics } from "./analytics";
import type { ReviewType } from "@/db/schema";

export type ReviewStats = {
  periodStart: string;
  periodEnd: string;
  tasks: { completed: number; created: number; stillOverdue: number };
  projects: { progressed: string[]; stalled: string[]; completed: string[] };
  goals: { moved: string[]; neglected: string[] };
  time: { label: string; minutes: number; intended: number | null }[];
  calendar: { meetingMinutes: number; focusMinutes: number; overloadedDays: number };
  health: { label: string; value: string; change: string | null }[];
  money: {
    savingsRate: number | null;
    incomeMinor: number;
    spentMinor: number;
    anomalies: string[];
  };
  habits: { name: string; hit: number; possible: number }[];
  journal: { entries: number; averageMood: number | null };
  neglectedAreas: string[];
};

/** The window a review covers, aligned to the week or calendar month. */
export function reviewPeriod(type: ReviewType, weekStartsOn = 1, offset = 0) {
  const now = new Date();
  if (type === "weekly") {
    const start = addDays(startOfWeek(now, weekStartsOn), offset * 7);
    return { start, end: addDays(start, 7) };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start, end };
}

/**
 * Every number in a review is computed here, from the database.
 *
 * The AI never produces these figures; it only writes prose around them. That
 * separation is what makes a generated review safe to trust and safe to edit.
 */
export async function buildReviewStats(
  userId: string,
  type: ReviewType,
  weekStartsOn = 1,
  offset = -1,
): Promise<ReviewStats> {
  const { start, end } = reviewPeriod(type, weekStartsOn, offset);

  const [
    completedRows, createdRows, overdueRows, projectList, goalList,
    events, timeAnalytics, cashflow, anomalies, sleep, workouts, habitRows, journalRows,
  ] = await Promise.all([
    db
      .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId, lifeAreaId: tasks.lifeAreaId })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.status, "done"),
          gte(tasks.completedAt, start),
          lt(tasks.completedAt, end),
        ),
      ),
    db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), gte(tasks.createdAt, start), lt(tasks.createdAt, end))),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} in ('todo','in_progress','blocked')`,
          lt(tasks.dueDate, end),
        ),
      ),
    listProjects(userId, { statuses: ["active", "completed", "on_hold"] }),
    listGoals(userId, { statuses: ["active"] }),
    getEventsBetween(userId, start, end),
    getTimeAnalytics(userId, type === "weekly" ? "week" : "month", weekStartsOn),
    getCashflowForRange(userId, isoDate(start), isoDate(end)),
    getSpendingAnomalies(userId),
    getMetricTrend(userId, "sleep_minutes"),
    getWorkoutStats(userId),
    db
      .select({ habitId: habitEntries.habitId, n: count() })
      .from(habitEntries)
      .where(
        and(
          eq(habitEntries.userId, userId),
          eq(habitEntries.completed, true),
          gte(habitEntries.date, isoDate(start)),
          lt(habitEntries.date, isoDate(end)),
        ),
      )
      .groupBy(habitEntries.habitId),
    db
      .select({ mood: journalEntries.mood })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.userId, userId),
          gte(journalEntries.date, isoDate(start)),
          lt(journalEntries.date, isoDate(end)),
        ),
      ),
  ]);

  const touchedProjectIds = new Set(completedRows.map((t) => t.projectId).filter(Boolean));
  const touchedAreaIds = new Set(completedRows.map((t) => t.lifeAreaId).filter(Boolean));

  const analytics = analyseEvents(events, start, type === "weekly" ? 7 : 30);

  const { habits, lifeAreas } = await import("@/db/schema");
  const [habitList, areaList] = await Promise.all([
    db
      .select({ id: habits.id, name: habits.name, frequency: habits.frequency })
      .from(habits)
      .where(and(eq(habits.userId, userId), eq(habits.active, true))),
    db
      .select({ id: lifeAreas.id, name: lifeAreas.name })
      .from(lifeAreas)
      .where(and(eq(lifeAreas.userId, userId), isNull(lifeAreas.archivedAt))),
  ]);

  const habitCounts = new Map(habitRows.map((r) => [r.habitId, r.n]));
  const periodDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const moods = journalRows.map((r) => r.mood).filter((m): m is number => m !== null);

  return {
    periodStart: isoDate(start),
    periodEnd: isoDate(addDays(end, -1)),
    tasks: {
      completed: completedRows.length,
      created: createdRows[0]?.n ?? 0,
      stillOverdue: overdueRows[0]?.n ?? 0,
    },
    projects: {
      progressed: projectList.filter((p) => touchedProjectIds.has(p.id)).map((p) => p.title),
      stalled: projectList.filter((p) => p.isStalled).map((p) => p.title),
      completed: projectList
        .filter((p) => p.completedAt && p.completedAt >= start && p.completedAt < end)
        .map((p) => p.title),
    },
    goals: {
      moved: goalList
        .filter((g) => g.lastProgressAt && g.lastProgressAt >= start && g.lastProgressAt < end)
        .map((g) => g.title),
      neglected: goalList.filter((g) => g.isNeglected).map((g) => g.title),
    },
    time: timeAnalytics.categories.map((c) => ({
      label: c.label,
      minutes: c.actualMinutes,
      intended: c.intendedMinutes,
    })),
    calendar: {
      meetingMinutes: analytics.meetingMinutes,
      focusMinutes: analytics.focusMinutes,
      overloadedDays: analytics.overloadedDays.length,
    },
    health: [
      sleep.hasData
        ? {
            label: "Sleep",
            value: `${formatDuration(sleep.recentAverage)} average`,
            change: sleep.deltaFormatted ? `${sleep.deltaFormatted} vs prior week` : null,
          }
        : { label: "Sleep", value: "No data connected", change: null },
      workouts.hasData
        ? { label: "Workouts", value: `${workouts.count} in 28 days`, change: null }
        : { label: "Workouts", value: "None recorded", change: null },
    ],
    money: {
      savingsRate: cashflow.savingsRate,
      incomeMinor: cashflow.incomeMinor,
      spentMinor: cashflow.expenseMinor,
      anomalies: anomalies.map((a) => `${a.label} is ${pct(a.changePct, 0)} above its baseline.`),
    },
    habits: habitList.map((h) => ({
      name: h.name,
      hit: habitCounts.get(h.id) ?? 0,
      possible: h.frequency === "weekly" ? Math.max(1, Math.round(periodDays / 7)) : periodDays,
    })),
    journal: {
      entries: journalRows.length,
      averageMood: moods.length ? Math.round(mean(moods) * 10) / 10 : null,
    },
    // An area is "neglected" for the period only if nothing at all was
    // completed under it. Stated as a fact, not a judgement.
    neglectedAreas: areaList.filter((a) => !touchedAreaIds.has(a.id)).map((a) => a.name),
  };
}

/**
 * Narrative sections written from the stats without a model.
 *
 * These are the fallback and the starting point: factual, readable, and
 * editable. The AI path rewrites them into prose but never changes the numbers.
 */
export function draftSections(stats: ReviewStats, type: ReviewType): Record<string, string> {
  const period = type === "weekly" ? "week" : "month";

  const wins = [
    `${stats.tasks.completed} tasks completed.`,
    stats.projects.progressed.length
      ? `Progress on ${stats.projects.progressed.join(", ")}.`
      : "No project saw task completions.",
    stats.projects.completed.length ? `Finished: ${stats.projects.completed.join(", ")}.` : "",
    stats.goals.moved.length ? `Goals that moved: ${stats.goals.moved.join(", ")}.` : "",
  ].filter(Boolean);

  const problems = [
    stats.tasks.stillOverdue > 0 ? `${stats.tasks.stillOverdue} tasks are still overdue.` : "",
    stats.projects.stalled.length ? `Stalled: ${stats.projects.stalled.join(", ")}.` : "",
    stats.goals.neglected.length
      ? `No recent progress on ${stats.goals.neglected.join(", ")}.`
      : "",
    stats.calendar.overloadedDays > 0
      ? `${stats.calendar.overloadedDays} ${stats.calendar.overloadedDays === 1 ? "day was" : "days were"} heavily booked with meetings.`
      : "",
    ...stats.money.anomalies,
  ].filter(Boolean);

  const time = [
    `${formatDuration(stats.calendar.meetingMinutes)} in meetings, ${formatDuration(stats.calendar.focusMinutes)} in focus blocks.`,
    ...stats.time
      .filter((t) => t.minutes > 0)
      .slice(0, 4)
      .map(
        (t) =>
          `${t.label}: ${formatDuration(t.minutes)}${
            t.intended !== null ? ` against ${formatDuration(t.intended)} intended` : ""
          }.`,
      ),
  ];

  return {
    wins: wins.join("\n") || `Nothing was recorded as completed this ${period}.`,
    problems: problems.join("\n") || "Nothing is flagged as going badly.",
    time: time.join("\n"),
    health: stats.health.map((h) => `${h.label}: ${h.value}${h.change ? ` (${h.change})` : ""}.`).join("\n"),
    money:
      [
        stats.money.savingsRate !== null
          ? `Savings rate ${Math.round(stats.money.savingsRate * 100)}% for the period.`
          : // A single week rarely contains a payday, so spending is the
            // figure worth reporting rather than an undefined ratio.
            `${formatMoney(stats.money.spentMinor)} spent. No income landed in this period, so there is no savings rate for it.`,
        ...stats.money.anomalies,
      ].join(" "),
    neglected: stats.neglectedAreas.length
      ? `No completed work in: ${stats.neglectedAreas.join(", ")}.`
      : "Every life area saw some activity.",
    habits: stats.habits.length
      ? stats.habits.map((h) => `${h.name}: ${h.hit} of ${h.possible}.`).join("\n")
      : "No habits tracked.",
    nextPeriod:
      [
        ...stats.projects.stalled.slice(0, 2).map((p) => `Decide the next step for ${p}, or pause it.`),
        ...stats.goals.neglected.slice(0, 1).map((g) => `Put one hour toward ${g}.`),
        stats.tasks.stillOverdue > 3
          ? "Clear or reschedule the overdue list; a long one stops being information."
          : "",
      ]
        .filter(Boolean)
        .join("\n") || "Nothing is obviously at risk. Pick what matters most to you.",
    reflection: "",
  };
}

export const SECTION_LABELS: Record<string, string> = {
  wins: "What went well",
  problems: "What went badly",
  time: "Where time went",
  health: "Health",
  money: "Money",
  neglected: "Neglected areas",
  habits: "Habits",
  nextPeriod: "Next period",
  reflection: "Your reflection",
};

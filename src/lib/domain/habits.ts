import "server-only";

import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { habitEntries, habits, lifeAreas, type Habit } from "@/db/schema";
import { addDays, daysBetween, isoDate, startOfDay } from "@/lib/utils";

/**
 * Completions the window should hold if the habit is kept at its target rate.
 *
 * Respects `targetPerPeriod`, so "five times a week" is measured against
 * roughly 21 sessions rather than four, and takes the number of days the habit
 * has actually existed — a habit started yesterday is not behind on a month.
 */
export function expectedCompletions(
  frequency: "daily" | "weekly",
  targetPerPeriod: number,
  days: number,
) {
  const perPeriod = Math.max(1, targetPerPeriod);
  const rate = frequency === "daily" ? Math.min(perPeriod, 1) : perPeriod / 7;
  return rate * Math.max(0, days);
}

export type HabitSummary = Habit & {
  areaName: string | null;
  areaColor: string | null;
  /** Oldest first, one entry per day in the window. */
  last30: { date: string; done: boolean }[];
  doneToday: boolean;
  streak: number;
  /** Share of expected completions made, or null while too new to judge. */
  consistency: number | null;
  completions30: number;
  expectedIn30: number;
  /** False when a day streak would be misleading for this frequency. */
  showsStreak: boolean;
};

/**
 * Current streak in consecutive days.
 *
 * Today not being done yet does not break a streak — it is still early. The
 * streak only breaks on a missed day that has already fully passed.
 */
export function computeStreak(completedDates: Set<string>, today = new Date()): number {
  let streak = 0;
  let cursor = startOfDay(today);

  if (!completedDates.has(isoDate(cursor))) {
    cursor = addDays(cursor, -1);
    if (!completedDates.has(isoDate(cursor))) return 0;
  }

  while (completedDates.has(isoDate(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export async function listHabits(userId: string): Promise<HabitSummary[]> {
  const rows = await db
    .select({ habit: habits, areaName: lifeAreas.name, areaColor: lifeAreas.color })
    .from(habits)
    .leftJoin(lifeAreas, eq(lifeAreas.id, habits.lifeAreaId))
    .where(and(eq(habits.userId, userId), eq(habits.active, true), isNull(habits.deletedAt)))
    .orderBy(asc(habits.createdAt));

  if (rows.length === 0) return [];

  const since = isoDate(addDays(startOfDay(new Date()), -29));
  const entries = await db
    .select()
    .from(habitEntries)
    .where(
      and(
        inArray(habitEntries.habitId, rows.map((r) => r.habit.id)),
        gte(habitEntries.date, since),
        eq(habitEntries.completed, true),
      ),
    );

  const byHabit = new Map<string, Set<string>>();
  for (const entry of entries) {
    const set = byHabit.get(entry.habitId) ?? new Set<string>();
    set.add(entry.date);
    byHabit.set(entry.habitId, set);
  }

  const today = isoDate(new Date());
  return rows.map(({ habit, areaName, areaColor }) => {
    const done = byHabit.get(habit.id) ?? new Set<string>();
    const last30 = Array.from({ length: 30 }, (_, i) => {
      const date = isoDate(addDays(startOfDay(new Date()), -(29 - i)));
      return { date, done: done.has(date) };
    });

    // Days the habit has actually been alive for, excluding today — today is
    // not over, and a habit is not behind because the evening has not happened.
    const daysActive = Math.min(30, Math.max(0, daysBetween(habit.createdAt, new Date())));
    const opportunities = expectedCompletions(habit.frequency, habit.targetPerPeriod, daysActive);

    return {
      ...habit,
      areaName,
      areaColor,
      last30,
      doneToday: done.has(today),
      // A day streak only means something for a daily habit. Something done
      // five days a week would "break" every weekend, which is both wrong and
      // discouraging, so those report completions instead.
      streak: habit.frequency === "daily" ? computeStreak(done) : done.size,
      showsStreak: habit.frequency === "daily",
      // Null rather than 0% when the habit is too new to have a record worth
      // judging. Reporting a day-old habit as 0% consistent is not a fact
      // about the habit, it is a fact about the calendar.
      consistency: opportunities >= 1 ? Math.min(1, done.size / opportunities) : null,
      completions30: done.size,
      expectedIn30: Math.round(opportunities),
    };
  });
}

/**
 * Habits worth showing on the dashboard for today. Daily ones always, plus any
 * weekly habit done most days — five-times-a-week is a today decision, whereas
 * a once-a-week review is not and would just be noise.
 */
export async function getTodaysHabits(userId: string) {
  const all = await listHabits(userId);
  return all.filter((h) => h.frequency === "daily" || h.targetPerPeriod >= 3);
}

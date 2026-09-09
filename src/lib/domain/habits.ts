import "server-only";

import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { habitEntries, habits, lifeAreas, type Habit } from "@/db/schema";
import { addDays, isoDate, startOfDay } from "@/lib/utils";

export type HabitSummary = Habit & {
  areaName: string | null;
  areaColor: string | null;
  /** Oldest first, one entry per day in the window. */
  last30: { date: string; done: boolean }[];
  doneToday: boolean;
  streak: number;
  /** Share of the last 30 periods that hit target, 0 to 1. */
  consistency: number;
  completions30: number;
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

    // Weekly habits have roughly four opportunities in 30 days, not thirty.
    const opportunities = habit.frequency === "weekly" ? 4 : 30;

    return {
      ...habit,
      areaName,
      areaColor,
      last30,
      doneToday: done.has(today),
      streak: habit.frequency === "daily" ? computeStreak(done) : done.size,
      consistency: Math.min(1, done.size / opportunities),
      completions30: done.size,
    };
  });
}

export async function getTodaysHabits(userId: string) {
  const all = await listHabits(userId);
  return all.filter((h) => h.frequency === "daily");
}

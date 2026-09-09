import "server-only";

import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { events, focusSessions, timeBudgets } from "@/db/schema";
import { addDays, startOfDay, startOfWeek, titleCase } from "@/lib/utils";
import { durationMinutes } from "./calendar";

export type TimePeriod = "week" | "month" | "quarter" | "year";

/**
 * Calendar categories collapse into the smaller set the brief asks about, so
 * "where did my time go" answers in life terms rather than calendar terms.
 */
const CATEGORY_MAP: Record<string, string> = {
  meeting: "meetings",
  focus: "deep_work",
  health: "health",
  social: "relationships",
  personal: "personal_growth",
  travel: "other",
  other: "other",
};

const ORDER = ["deep_work", "meetings", "health", "relationships", "personal_growth", "other"];

export type TimeCategory = {
  category: string;
  label: string;
  actualMinutes: number;
  /** Scaled from the weekly budget to the length of this period, or null if unset. */
  intendedMinutes: number | null;
  varianceMinutes: number | null;
};

export type TimeAnalytics = {
  from: Date;
  to: Date;
  weeks: number;
  categories: TimeCategory[];
  totalMinutes: number;
  hasData: boolean;
};

function windowFor(period: TimePeriod, weekStartsOn: number) {
  const today = startOfDay(new Date());
  switch (period) {
    case "week": {
      const from = startOfWeek(today, weekStartsOn);
      return { from, to: addDays(from, 7), weeks: 1 };
    }
    case "month": {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      const to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return { from, to, weeks: (to.getTime() - from.getTime()) / (7 * 86_400_000) };
    }
    case "quarter": {
      const q = Math.floor(today.getMonth() / 3);
      const from = new Date(today.getFullYear(), q * 3, 1);
      const to = new Date(today.getFullYear(), q * 3 + 3, 1);
      return { from, to, weeks: (to.getTime() - from.getTime()) / (7 * 86_400_000) };
    }
    default: {
      const from = new Date(today.getFullYear(), 0, 1);
      const to = new Date(today.getFullYear() + 1, 0, 1);
      return { from, to, weeks: 52 };
    }
  }
}

/**
 * Where time actually went, against where the user said they intended it to go.
 *
 * Actuals come from calendar events plus recorded focus sessions. This is
 * honest about its own limits: it measures what was on the calendar or timed,
 * not every waking minute, and the UI says so.
 */
export async function getTimeAnalytics(
  userId: string,
  period: TimePeriod = "week",
  weekStartsOn = 1,
): Promise<TimeAnalytics> {
  const { from, to, weeks } = windowFor(period, weekStartsOn);

  const [eventRows, focusRows, budgets] = await Promise.all([
    db
      .select()
      .from(events)
      .where(
        and(
          eq(events.userId, userId),
          isNull(events.deletedAt),
          gte(events.startsAt, from),
          lt(events.startsAt, to),
        ),
      ),
    db
      .select()
      .from(focusSessions)
      .where(
        and(
          eq(focusSessions.userId, userId),
          gte(focusSessions.startedAt, from),
          lt(focusSessions.startedAt, to),
        ),
      ),
    db.select().from(timeBudgets).where(eq(timeBudgets.userId, userId)),
  ]);

  const totals = new Map<string, number>();
  for (const event of eventRows) {
    if (event.allDay) continue;
    const category = CATEGORY_MAP[event.category] ?? "other";
    totals.set(category, (totals.get(category) ?? 0) + durationMinutes(event));
  }
  for (const session of focusRows) {
    // A focus block already on the calendar would double count; only sessions
    // actually timed in the app are added here.
    totals.set("deep_work", (totals.get("deep_work") ?? 0) + Math.round(session.elapsedSeconds / 60));
  }

  const budgetMap = new Map(budgets.map((b) => [b.category, b.intendedMinutesPerWeek]));
  const categories: TimeCategory[] = ORDER.map((category) => {
    const actualMinutes = Math.round(totals.get(category) ?? 0);
    const weekly = budgetMap.get(category);
    const intendedMinutes = weekly !== undefined ? Math.round(weekly * weeks) : null;
    return {
      category,
      label: titleCase(category),
      actualMinutes,
      intendedMinutes,
      varianceMinutes: intendedMinutes === null ? null : actualMinutes - intendedMinutes,
    };
  }).sort((a, b) => b.actualMinutes - a.actualMinutes);

  const totalMinutes = categories.reduce((sum, c) => sum + c.actualMinutes, 0);

  return { from, to, weeks, categories, totalMinutes, hasData: totalMinutes > 0 };
}

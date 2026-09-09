import "server-only";

import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { metrics, workouts, type MetricKind } from "@/db/schema";
import { addDays, formatDuration, isoDate, mean, startOfDay } from "@/lib/utils";

export const METRIC_LABEL: Record<MetricKind, string> = {
  sleep_minutes: "Sleep",
  resting_heart_rate: "Resting heart rate",
  hrv: "HRV",
  steps: "Steps",
  active_minutes: "Active minutes",
  weight_kg: "Weight",
  calories: "Calories",
  recovery_score: "Recovery",
};

/**
 * Whether a rise in this metric is a good thing. Used by trend indicators so
 * "resting heart rate down 3 bpm" is shown as an improvement, not a decline.
 */
export const METRIC_GOOD_DIRECTION: Record<MetricKind, "up" | "down" | "neutral"> = {
  sleep_minutes: "up",
  resting_heart_rate: "down",
  hrv: "up",
  steps: "up",
  active_minutes: "up",
  weight_kg: "neutral",
  calories: "neutral",
  recovery_score: "up",
};

export type MetricTrend = {
  kind: MetricKind;
  label: string;
  unit: string;
  /** Oldest first, for sparklines. */
  series: { date: string; value: number }[];
  recentAverage: number | null;
  priorAverage: number | null;
  /** Absolute change between the two windows, in the metric's own unit. */
  delta: number | null;
  direction: "up" | "down" | "flat";
  goodDirection: "up" | "down" | "neutral";
  formatted: string | null;
  deltaFormatted: string | null;
  hasData: boolean;
};

function formatMetric(kind: MetricKind, value: number | null): string | null {
  if (value === null) return null;
  switch (kind) {
    case "sleep_minutes":
      return formatDuration(value);
    case "weight_kg":
      return `${value.toFixed(1)} kg`;
    case "resting_heart_rate":
      return `${Math.round(value)} bpm`;
    case "hrv":
      return `${Math.round(value)} ms`;
    case "steps":
    case "calories":
      return Math.round(value).toLocaleString();
    default:
      return String(Math.round(value));
  }
}

function formatDelta(kind: MetricKind, delta: number): string {
  const sign = delta > 0 ? "+" : "";
  if (kind === "sleep_minutes") {
    return `${sign}${formatDuration(Math.abs(delta))?.replace(/^/, delta < 0 ? "-" : "")}`;
  }
  if (kind === "weight_kg") return `${sign}${delta.toFixed(1)} kg`;
  return `${sign}${Math.round(delta)}`;
}

/**
 * Compares the last `window` days against the `window` days before that.
 *
 * Returns `hasData: false` rather than a zero when nothing has been recorded,
 * so the UI can say "not connected yet" instead of implying a real reading.
 */
export async function getMetricTrend(
  userId: string,
  kind: MetricKind,
  window = 7,
  historyDays = 30,
): Promise<MetricTrend> {
  const since = isoDate(addDays(startOfDay(new Date()), -historyDays));
  const rows = await db
    .select({ date: metrics.date, value: metrics.value, unit: metrics.unit })
    .from(metrics)
    .where(
      and(
        eq(metrics.userId, userId),
        eq(metrics.kind, kind),
        isNull(metrics.deletedAt),
        gte(metrics.date, since),
      ),
    )
    .orderBy(asc(metrics.date));

  const series = rows.map((r) => ({ date: r.date, value: r.value }));
  const values = series.map((s) => s.value);
  const recent = values.slice(-window);
  const prior = values.slice(-window * 2, -window);

  const recentAverage = recent.length ? mean(recent) : null;
  const priorAverage = prior.length ? mean(prior) : null;
  const delta =
    recentAverage !== null && priorAverage !== null ? recentAverage - priorAverage : null;

  // A change smaller than 2% of the baseline is noise, not a trend.
  const threshold = priorAverage !== null ? Math.abs(priorAverage) * 0.02 : 0;
  const direction: MetricTrend["direction"] =
    delta === null || Math.abs(delta) < threshold ? "flat" : delta > 0 ? "up" : "down";

  return {
    kind,
    label: METRIC_LABEL[kind],
    unit: rows[0]?.unit ?? "",
    series,
    recentAverage,
    priorAverage,
    delta,
    direction,
    goodDirection: METRIC_GOOD_DIRECTION[kind],
    formatted: formatMetric(kind, recentAverage),
    deltaFormatted: delta !== null && direction !== "flat" ? formatDelta(kind, delta) : null,
    hasData: series.length > 0,
  };
}

export async function getHealthOverview(userId: string) {
  const kinds: MetricKind[] = ["sleep_minutes", "resting_heart_rate", "hrv", "steps", "weight_kg"];
  return Promise.all(kinds.map((kind) => getMetricTrend(userId, kind)));
}

export async function getRecentWorkouts(userId: string, days = 28) {
  return db
    .select()
    .from(workouts)
    .where(
      and(
        eq(workouts.userId, userId),
        isNull(workouts.deletedAt),
        gte(workouts.startedAt, addDays(new Date(), -days)),
      ),
    )
    .orderBy(desc(workouts.startedAt));
}

export async function getWorkoutStats(userId: string) {
  const [recent, prior] = await Promise.all([
    getRecentWorkouts(userId, 28),
    db
      .select()
      .from(workouts)
      .where(
        and(
          eq(workouts.userId, userId),
          isNull(workouts.deletedAt),
          gte(workouts.startedAt, addDays(new Date(), -56)),
        ),
      ),
  ]);

  const priorWindow = prior.filter((w) => w.startedAt < addDays(new Date(), -28));
  const totalMinutes = recent.reduce((sum, w) => sum + (w.durationMinutes ?? 0), 0);
  const distance = recent.reduce((sum, w) => sum + (w.distanceMeters ?? 0), 0);

  return {
    count: recent.length,
    priorCount: priorWindow.length,
    perWeek: Math.round((recent.length / 4) * 10) / 10,
    totalMinutes,
    distanceKm: Math.round((distance / 1000) * 10) / 10,
    workouts: recent,
    hasData: recent.length > 0 || priorWindow.length > 0,
  };
}

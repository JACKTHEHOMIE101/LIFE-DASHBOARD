import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { goals, lifeAreas, projects, type Goal, type GoalStatus } from "@/db/schema";
import { clamp, daysBetween } from "@/lib/utils";

export { GOAL_STATUS_LABEL } from "./labels";

/** A goal with no recorded progress for this long is surfaced as neglected. */
export const NEGLECT_THRESHOLD_DAYS = 21;

/**
 * Progress toward a goal, as a fraction from 0 to 1, or null when there is
 * nothing honest to compute from.
 *
 * Measured against `startValue` rather than zero so a goal that begins at
 * $108k on the way to $250k does not open at 43% complete. Goals that count
 * downward (a target below the start) are handled by the same formula.
 */
export function computeGoalProgress(goal: {
  startValue: number | null;
  currentValue: number | null;
  targetValue: number | null;
  manualProgress: number | null;
}): number | null {
  if (goal.targetValue !== null && goal.currentValue !== null) {
    const start = goal.startValue ?? 0;
    const span = goal.targetValue - start;
    if (span === 0) return goal.currentValue >= goal.targetValue ? 1 : 0;
    return clamp((goal.currentValue - start) / span);
  }
  if (goal.manualProgress !== null) return clamp(goal.manualProgress);
  return null;
}

/**
 * How far through the goal's timeline we are, so progress can be compared
 * against elapsed time rather than judged in a vacuum.
 */
export function computeTimeElapsed(goal: {
  createdAt: Date;
  targetDate: Date | null;
}): number | null {
  if (!goal.targetDate) return null;
  const total = goal.targetDate.getTime() - goal.createdAt.getTime();
  if (total <= 0) return 1;
  return clamp((Date.now() - goal.createdAt.getTime()) / total);
}

export type GoalSummary = Goal & {
  areaName: string | null;
  areaColor: string | null;
  progress: number | null;
  timeElapsed: number | null;
  /** True when the clock has run further than the work. */
  behindSchedule: boolean;
  daysSinceProgress: number | null;
  isNeglected: boolean;
  daysRemaining: number | null;
  projectCount: number;
};

export async function listGoals(
  userId: string,
  options: { statuses?: GoalStatus[]; lifeAreaId?: string } = {},
): Promise<GoalSummary[]> {
  const statuses = options.statuses ?? ["active", "paused"];
  const conditions = [
    eq(goals.userId, userId),
    isNull(goals.deletedAt),
    inArray(goals.status, statuses),
  ];
  if (options.lifeAreaId) conditions.push(eq(goals.lifeAreaId, options.lifeAreaId));

  const rows = await db
    .select({ goal: goals, areaName: lifeAreas.name, areaColor: lifeAreas.color })
    .from(goals)
    .leftJoin(lifeAreas, eq(lifeAreas.id, goals.lifeAreaId))
    .where(and(...conditions))
    .orderBy(asc(goals.targetDate));

  if (rows.length === 0) return [];

  const linkedProjects = await db
    .select({ goalId: projects.goalId, id: projects.id })
    .from(projects)
    .where(
      and(
        inArray(projects.goalId, rows.map((r) => r.goal.id)),
        isNull(projects.deletedAt),
      ),
    );

  const projectCounts = new Map<string, number>();
  for (const p of linkedProjects) {
    if (p.goalId) projectCounts.set(p.goalId, (projectCounts.get(p.goalId) ?? 0) + 1);
  }

  const now = new Date();
  return rows.map(({ goal, areaName, areaColor }) => {
    const progress = computeGoalProgress(goal);
    const timeElapsed = computeTimeElapsed(goal);
    const daysSinceProgress = goal.lastProgressAt ? daysBetween(goal.lastProgressAt, now) : null;

    return {
      ...goal,
      areaName,
      areaColor,
      progress,
      timeElapsed,
      // Only a claim when both halves are known, and only past a real margin.
      behindSchedule:
        progress !== null && timeElapsed !== null && timeElapsed - progress > 0.15,
      daysSinceProgress,
      isNeglected:
        goal.status === "active" &&
        daysSinceProgress !== null &&
        daysSinceProgress >= NEGLECT_THRESHOLD_DAYS,
      daysRemaining: goal.targetDate ? daysBetween(now, goal.targetDate) : null,
      projectCount: projectCounts.get(goal.id) ?? 0,
    };
  });
}

export async function getNeglectedGoals(userId: string) {
  const all = await listGoals(userId, { statuses: ["active"] });
  return all.filter((g) => g.isNeglected);
}

/** Formats the metric line, e.g. "$179,400 of $250,000". */
export function formatGoalMetric(goal: Pick<Goal, "currentValue" | "targetValue" | "metricUnit">) {
  if (goal.currentValue === null || goal.targetValue === null) return null;
  const unit = goal.metricUnit ?? "";
  const fmt = (n: number) =>
    unit === "USD"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
      : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n)}${unit ? ` ${unit}` : ""}`;
  return `${fmt(goal.currentValue)} of ${fmt(goal.targetValue)}`;
}

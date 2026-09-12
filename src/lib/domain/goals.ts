import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  goals, lifeAreas, projectGoals, projects, type Goal, type GoalKind, type GoalStatus,
} from "@/db/schema";
import { clamp, daysBetween } from "@/lib/utils";

export { GOAL_STATUS_LABEL } from "./labels";

/**
 * Silence tolerated on a goal with no deadline, and the ceiling for any goal.
 *
 * A goal you will get to eventually does not need chasing every week.
 */
export const NEGLECT_THRESHOLD_DAYS = 21;

/** Below this, chasing a goal is nagging rather than warning. */
export const NEGLECT_FLOOR_DAYS = 3;

/**
 * The fraction of a goal's remaining time that may pass in silence.
 *
 * A flat threshold treats "three weeks quiet on a two-year goal" the same as
 * "three weeks quiet on a seven-week goal". The second is 40% of the runway
 * gone, and by the time a fixed 21-day rule notices, the plan has usually
 * already failed — which is exactly the failure this app exists to prevent.
 */
const NEGLECT_FRACTION_OF_REMAINING = 0.08;

/**
 * How long this particular goal may go quiet before it is worth saying so.
 *
 * Scaled to the deadline, floored so it cannot nag, capped so a distant goal
 * is not chased weekly.
 */
export function neglectThresholdDays(daysRemaining: number | null) {
  if (daysRemaining === null || daysRemaining <= 0) return NEGLECT_THRESHOLD_DAYS;
  return Math.round(
    Math.min(
      NEGLECT_THRESHOLD_DAYS,
      Math.max(NEGLECT_FLOOR_DAYS, daysRemaining * NEGLECT_FRACTION_OF_REMAINING),
    ),
  );
}

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
  kind?: GoalKind;
}): number | null {
  // A floor or a ceiling has no percentage. You are holding the line or you
  // are not, and that question stays open until the goal ends.
  if (goal.kind === "floor" || goal.kind === "ceiling") return null;

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

/**
 * Below this much history, an achieved rate is noise rather than a trend.
 *
 * A goal three days old that has moved once would otherwise project a
 * triumphant finish or a catastrophic miss with equal confidence.
 */
export const PACE_MINIMUM_DAYS = 10;

/**
 * A goal is only judged off pace once the projected miss is this big, in
 * whichever units it counts. Below it the projection is inside its own noise.
 */
export const PACE_SHORTFALL_UNITS = 1;

export type GoalPace = {
  /** Units still to cover between here and the target. */
  remaining: number;
  daysRemaining: number;
  /** Units per week needed from today to arrive on time. */
  requiredPerWeek: number;
  /** Units per week achieved so far. Null until there is enough history. */
  actualPerWeek: number | null;
  /** Where the achieved rate lands on the target date. Null without a rate. */
  projectedValue: number | null;
  /** How far short that projection falls. Null without a rate, 0 when it does not. */
  shortfall: number | null;
  /** Null rather than false when there is not yet enough history to say. */
  onPace: boolean | null;
  methodology: string;
};

/**
 * The rate a goal needs versus the rate it is getting.
 *
 * Comparing progress to elapsed time — which is what the rest of this module
 * does — answers "am I behind?" but not "can I still get there?". A goal can
 * sit at 20% with 4% of the time gone and still be unreachable, because the
 * 20% was where it started rather than ground covered.
 *
 * Returns null wherever the question has no honest answer: goals without a
 * number or a date, goals already met, and deadlines already past, which other
 * signals cover.
 */
export function computeGoalPace(
  goal: {
    kind?: GoalKind;
    startValue: number | null;
    currentValue: number | null;
    targetValue: number | null;
    targetDate: Date | null;
    createdAt: Date;
  },
  now: Date = new Date(),
): GoalPace | null {
  // A floor or a ceiling is held, not accumulated; there is no rate to run at.
  if (goal.kind === "floor" || goal.kind === "ceiling") return null;
  if (goal.targetDate === null || goal.targetValue === null || goal.currentValue === null) return null;

  const start = goal.startValue ?? 0;
  const direction = goal.targetValue >= start ? 1 : -1;

  const remaining = (goal.targetValue - goal.currentValue) * direction;
  if (remaining <= 0) return null; // Already there.

  const msPerDay = 86_400_000;
  const daysRemaining = Math.ceil((goal.targetDate.getTime() - now.getTime()) / msPerDay);
  if (daysRemaining <= 0) return null; // Overdue is a different problem.

  const requiredPerWeek = (remaining / daysRemaining) * 7;

  const daysElapsed = (now.getTime() - goal.createdAt.getTime()) / msPerDay;
  const covered = (goal.currentValue - start) * direction;

  const enoughHistory = daysElapsed >= PACE_MINIMUM_DAYS;
  const actualPerWeek = enoughHistory ? (covered / daysElapsed) * 7 : null;

  const projectedValue =
    actualPerWeek === null ? null : goal.currentValue + (actualPerWeek / 7) * daysRemaining * direction;

  const shortfall =
    projectedValue === null ? null : Math.max(0, (goal.targetValue - projectedValue) * direction);

  return {
    remaining,
    daysRemaining,
    requiredPerWeek,
    actualPerWeek,
    projectedValue,
    shortfall,
    onPace: shortfall === null ? null : shortfall < PACE_SHORTFALL_UNITS,
    methodology:
      `${remaining.toLocaleString()} to go in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} ` +
      `needs ${requiredPerWeek.toFixed(1)} a week. ` +
      (actualPerWeek === null
        ? `Your own rate is not reported until the goal is ${PACE_MINIMUM_DAYS} days old.`
        : `You are averaging ${actualPerWeek.toFixed(1)} a week since the goal was set.`),
  };
}

export type CommitmentGap = {
  habitName: string;
  /** What the habit's own target delivers per week, if followed exactly. */
  plannedPerWeek: number;
  requiredPerWeek: number;
  /** Units short on the target date if the plan is kept perfectly. */
  shortfallAtTarget: number;
  methodology: string;
};

/**
 * Whether the habit attached to a goal can actually reach it.
 *
 * This is the one pace question answerable on day one: it compares what the
 * user committed to against what the arithmetic demands, needing no history at
 * all. A plan that cannot succeed even when followed perfectly is worth saying
 * out loud early, while there is still time to change the plan.
 */
export function computeCommitmentGap(
  pace: GoalPace,
  habit: { name: string; frequency: "daily" | "weekly"; targetPerPeriod: number },
): CommitmentGap | null {
  const perPeriod = Math.max(0, habit.targetPerPeriod);
  if (perPeriod === 0) return null;

  // A daily habit cannot be done more than once a day, which is the same cap
  // the consistency calculation applies.
  const plannedPerWeek = habit.frequency === "daily" ? Math.min(perPeriod, 1) * 7 : perPeriod;

  if (plannedPerWeek >= pace.requiredPerWeek) return null;

  const shortfallAtTarget = pace.remaining - (plannedPerWeek / 7) * pace.daysRemaining;
  if (shortfallAtTarget < PACE_SHORTFALL_UNITS) return null;

  return {
    habitName: habit.name,
    plannedPerWeek,
    requiredPerWeek: pace.requiredPerWeek,
    shortfallAtTarget,
    methodology:
      `"${habit.name}" is set to ${plannedPerWeek.toFixed(0)} a week. ` +
      `Reaching the target needs ${pace.requiredPerWeek.toFixed(1)}. ` +
      `Kept perfectly, the plan arrives about ${Math.round(shortfallAtTarget)} short.`,
  };
}

export type PlanRunway = {
  habitName: string;
  /** What the plan delivers per week if kept exactly. */
  plannedPerWeek: number;
  /** Days of work the plan still needs to cover what is left. */
  daysNeeded: number;
  /**
   * Days that may still be lost before the plan becomes unable to finish.
   * Zero or negative means it already cannot.
   */
  slackDays: number;
  /** The date after which the plan can no longer reach the goal. */
  breaksOn: Date;
  methodology: string;
};

/**
 * How much delay a goal's plan can still absorb.
 *
 * "You are behind" is a judgement about the past and easy to argue with. This
 * is a date: keep the plan exactly as written, start no later than this, and
 * you finish — miss it and no amount of keeping the plan is enough.
 *
 * The arithmetic is deliberately generous to the user. It assumes the plan is
 * kept perfectly from the moment they start, so the date it produces is the
 * last possible one rather than a comfortable one.
 */
export function computePlanRunway(
  pace: GoalPace,
  habit: { name: string; frequency: "daily" | "weekly"; targetPerPeriod: number },
  targetDate: Date,
): PlanRunway | null {
  const perPeriod = Math.max(0, habit.targetPerPeriod);
  if (perPeriod === 0) return null;

  // A daily habit cannot be done twice in a day, whatever its target says.
  const plannedPerWeek = habit.frequency === "daily" ? Math.min(perPeriod, 1) * 7 : perPeriod;
  if (plannedPerWeek <= 0) return null;

  const daysNeeded = Math.ceil((pace.remaining / plannedPerWeek) * 7);
  const slackDays = pace.daysRemaining - daysNeeded;

  const breaksOn = new Date(targetDate.getTime() - daysNeeded * 86_400_000);

  return {
    habitName: habit.name,
    plannedPerWeek,
    daysNeeded,
    slackDays,
    breaksOn,
    methodology:
      `${Math.round(pace.remaining)} left at ${plannedPerWeek.toFixed(0)} a week takes ` +
      `${daysNeeded} days, and there are ${pace.daysRemaining}. ` +
      (slackDays > 0
        ? `${slackDays} day${slackDays === 1 ? "" : "s"} of slack remain.`
        : "The plan can no longer reach the target."),
  };
}

export type ThresholdState = {
  /** True while the current reading is on the right side of the line. */
  meeting: boolean;
  /** Distance from the line, always positive. */
  margin: number;
  /** "above" for a floor, "below" for a ceiling. */
  side: "above" | "below";
};

/**
 * Where a floor or ceiling goal stands right now.
 *
 * Returns null for ordinary target goals, and for threshold goals that have no
 * reading yet — there is nothing to judge until a number exists.
 */
export function computeThresholdState(goal: {
  kind?: GoalKind;
  currentValue: number | null;
  targetValue: number | null;
}): ThresholdState | null {
  if (goal.kind !== "floor" && goal.kind !== "ceiling") return null;
  if (goal.currentValue === null || goal.targetValue === null) return null;

  const meeting =
    goal.kind === "floor"
      ? goal.currentValue >= goal.targetValue
      : goal.currentValue <= goal.targetValue;

  return {
    meeting,
    margin: Math.abs(goal.currentValue - goal.targetValue),
    side: goal.kind === "floor" ? "above" : "below",
  };
}

export type GoalSummary = Goal & {
  areaName: string | null;
  areaColor: string | null;
  /** Title of the goal this one rolls up into, when it is a sub-goal. */
  parentTitle: string | null;
  /** Null for floor and ceiling goals, which have no percentage. */
  progress: number | null;
  /** Set only for floor and ceiling goals that have a reading. */
  threshold: ThresholdState | null;
  timeElapsed: number | null;
  /** True when the clock has run further than the work. */
  behindSchedule: boolean;
  daysSinceProgress: number | null;
  isNeglected: boolean;
  /** Published so the UI can say how long this goal in particular may go quiet. */
  neglectThresholdDays: number;
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

  const goalIds = rows.map((r) => r.goal.id);

  // A project counts toward a goal whether it is the primary link or one of
  // the extra ones, so a goal is never reported as having nothing working on
  // it just because it is not some project's headline goal.
  const [primaryLinks, extraLinks] = await Promise.all([
    db
      .select({ goalId: projects.goalId, id: projects.id })
      .from(projects)
      .where(and(inArray(projects.goalId, goalIds), isNull(projects.deletedAt))),
    db
      .select({ goalId: projectGoals.goalId, id: projectGoals.projectId })
      .from(projectGoals)
      .innerJoin(projects, eq(projects.id, projectGoals.projectId))
      .where(and(inArray(projectGoals.goalId, goalIds), isNull(projects.deletedAt))),
  ]);

  const seen = new Map<string, Set<string>>();
  for (const link of [...primaryLinks, ...extraLinks]) {
    if (!link.goalId) continue;
    const set = seen.get(link.goalId) ?? new Set<string>();
    set.add(link.id);
    seen.set(link.goalId, set);
  }
  const projectCounts = new Map([...seen].map(([goalId, ids]) => [goalId, ids.size]));

  // Parent titles resolved from the same result set, so a sub-goal can say what
  // it rolls up into without a second query per row.
  const titleById = new Map(rows.map((r) => [r.goal.id, r.goal.title]));

  const now = new Date();
  return rows.map(({ goal, areaName, areaColor }) => {
    const progress = computeGoalProgress(goal);
    const timeElapsed = computeTimeElapsed(goal);
    const daysSinceProgress = goal.lastProgressAt ? daysBetween(goal.lastProgressAt, now) : null;
    const daysRemaining = goal.targetDate ? daysBetween(now, goal.targetDate) : null;

    return {
      ...goal,
      areaName,
      areaColor,
      parentTitle: goal.parentGoalId ? (titleById.get(goal.parentGoalId) ?? null) : null,
      progress,
      timeElapsed,
      threshold: computeThresholdState(goal),
      // Only a climb can fall behind a schedule, and only past a real margin.
      // A floor is either held or breached, which is reported separately.
      behindSchedule:
        progress !== null && timeElapsed !== null && timeElapsed - progress > 0.15,
      daysSinceProgress,
      isNeglected:
        goal.status === "active" &&
        daysSinceProgress !== null &&
        daysSinceProgress >= neglectThresholdDays(daysRemaining),
      neglectThresholdDays: neglectThresholdDays(daysRemaining),
      daysRemaining,
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

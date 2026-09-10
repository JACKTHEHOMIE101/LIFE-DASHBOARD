import "server-only";

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { reviews, signalDismissals, tasks } from "@/db/schema";
import { addDays, daysBetween, formatDuration, isoDate, pct, startOfDay, startOfWeek } from "@/lib/utils";
import { getSpendingAnomalies } from "./finances";
import { getMetricTrend } from "./health";
import { getNeglectedGoals, listGoals } from "./goals";
import { getStalledProjects } from "./projects";
import { getRelationshipsNeedingAttention, getUpcomingDates } from "./relationships";
import { analyseEvents, getEventsBetween } from "./calendar";

export type AttentionSeverity = "critical" | "high" | "normal";

export type AttentionSignal = {
  /** Stable across recomputes so dismissals and snoozes stick to the right thing. */
  key: string;
  category: "tasks" | "calendar" | "projects" | "goals" | "health" | "finance" | "relationships" | "system";
  severity: AttentionSeverity;
  title: string;
  /**
   * Why this is on screen. Required by the brief, and required by the product:
   * a warning that cannot explain itself is noise.
   */
  why: string;
  href: string;
  /** Prefilled prompt for handing the signal to the Chief of Staff. */
  askPrompt: string;
  /** Suggested task title if the user wants to turn this into an action. */
  suggestedTask?: string;
};

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, high: 1, normal: 2 };

/**
 * Everything worth interrupting someone about, each carrying its own reason.
 *
 * Detectors are deliberately conservative: each one needs a real threshold to
 * fire, so the panel stays short enough to actually be read. Anything the user
 * dismissed or snoozed is filtered out at the end.
 */
export async function getAttentionSignals(userId: string, weekStartsOn = 1) {
  const now = new Date();
  const signals: AttentionSignal[] = [];

  const [
    overdueRows,
    stalled,
    neglectedGoals,
    allGoals,
    overdueContacts,
    upcomingDates,
    anomalies,
    sleep,
    weekEvents,
    lastReview,
    dismissals,
  ] = await Promise.all([
    db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, priority: tasks.priority })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} in ('todo','in_progress','blocked')`,
          lt(tasks.dueDate, startOfDay(now)),
        ),
      )
      .orderBy(tasks.dueDate),
    getStalledProjects(userId),
    getNeglectedGoals(userId),
    listGoals(userId, { statuses: ["active"] }),
    getRelationshipsNeedingAttention(userId, 3),
    getUpcomingDates(userId, 14),
    getSpendingAnomalies(userId),
    getMetricTrend(userId, "sleep_minutes"),
    getEventsBetween(userId, startOfWeek(now, weekStartsOn), addDays(startOfWeek(now, weekStartsOn), 7)),
    db
      .select()
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.type, "weekly")))
      .orderBy(sql`${reviews.periodStart} desc`)
      .limit(1),
    db.select().from(signalDismissals).where(eq(signalDismissals.userId, userId)),
  ]);

  /* ------------------------------------------------------------- tasks */

  if (overdueRows.length > 0) {
    const oldest = overdueRows[0];
    const days = oldest.dueDate ? Math.abs(daysBetween(now, oldest.dueDate)) : 0;
    signals.push({
      key: "tasks:overdue",
      category: "tasks",
      severity: overdueRows.length >= 5 || days >= 7 ? "high" : "normal",
      title:
        overdueRows.length === 1
          ? `"${oldest.title}" is overdue`
          : `${overdueRows.length} tasks are overdue`,
      why:
        overdueRows.length === 1
          ? `It was due ${days} ${days === 1 ? "day" : "days"} ago and is still open.`
          : `The oldest, "${oldest.title}", was due ${days} ${days === 1 ? "day" : "days"} ago.`,
      href: "/tasks?view=overdue",
      askPrompt: "I have overdue tasks. Help me decide what to drop, reschedule and do first.",
    });
  }

  /* ---------------------------------------------------------- projects */

  for (const project of stalled.slice(0, 3)) {
    signals.push({
      key: `projects:stalled:${project.id}`,
      category: "projects",
      severity: project.deadline && daysBetween(now, project.deadline) <= 14 ? "high" : "normal",
      title: `${project.title} has stalled`,
      why: `No activity for ${project.daysInactive} days${
        project.deadline
          ? `, and the deadline is ${daysBetween(now, project.deadline) < 0 ? "already past" : `in ${daysBetween(now, project.deadline)} days`}.`
          : "."
      }`,
      href: `/projects/${project.id}`,
      askPrompt: `Why might "${project.title}" have stalled, and what is the smallest next step?`,
      suggestedTask: project.nextAction ? undefined : `Decide the next step for ${project.title}`,
    });
  }

  /* ------------------------------------------------------------- goals */

  for (const goal of neglectedGoals.slice(0, 2)) {
    signals.push({
      key: `goals:neglected:${goal.id}`,
      category: "goals",
      severity: "normal",
      title: `No progress on "${goal.title}"`,
      why: `Nothing has moved this goal for ${goal.daysSinceProgress} days${
        goal.daysRemaining !== null && goal.daysRemaining > 0
          ? `, with ${goal.daysRemaining} days until the target date.`
          : "."
      }`,
      href: "/goals",
      askPrompt: `I have not made progress on "${goal.title}". What is a realistic way back in?`,
      suggestedTask: `Spend 30 minutes on ${goal.title}`,
    });
  }

  // A floor that has been breached is more urgent than a climb running late:
  // the line is already crossed rather than merely at risk.
  for (const goal of allGoals.filter((g) => g.threshold && !g.threshold.meeting).slice(0, 2)) {
    const unit = goal.metricUnit && goal.metricUnit !== "USD" ? ` ${goal.metricUnit}` : "";
    signals.push({
      key: `goals:threshold:${goal.id}`,
      category: "goals",
      severity: "high",
      title: `"${goal.title}" has slipped below your line`,
      why: `${goal.currentValue}${unit} against a ${goal.targetValue}${unit} target${
        goal.daysRemaining !== null && goal.daysRemaining > 0
          ? `, with ${goal.daysRemaining} days left to recover it.`
          : "."
      }`,
      href: "/goals",
      askPrompt: `"${goal.title}" has dropped below the line I set. What would it take to pull it back?`,
    });
  }

  for (const goal of allGoals.filter((g) => g.behindSchedule && !g.isNeglected).slice(0, 2)) {
    const progressPct = Math.round((goal.progress ?? 0) * 100);
    const elapsedPct = Math.round((goal.timeElapsed ?? 0) * 100);
    signals.push({
      key: `goals:behind:${goal.id}`,
      category: "goals",
      severity: "normal",
      title: `"${goal.title}" is behind its timeline`,
      why: `${progressPct}% complete with ${elapsedPct}% of the time to the target date already used.`,
      href: "/goals",
      askPrompt: `"${goal.title}" is behind schedule. Should I change the plan or the deadline?`,
    });
  }

  /* ---------------------------------------------------------- calendar */

  const weekAnalytics = analyseEvents(weekEvents, startOfWeek(now, weekStartsOn), 7);
  if (weekAnalytics.overloadedDays.length > 0) {
    const worst = weekAnalytics.overloadedDays[0];
    signals.push({
      key: `calendar:overload:${isoDate(worst.date)}`,
      category: "calendar",
      severity: "normal",
      title: `${worst.date.toLocaleDateString("en-GB", { weekday: "long" })} is heavily booked`,
      why: `${formatDuration(worst.meetingMinutes)} of meetings that day, leaving little room for anything else.`,
      href: "/calendar",
      askPrompt: "My calendar is overloaded this week. What should I move or decline?",
    });
  }

  if (weekAnalytics.fragmentedDays.length >= 2) {
    signals.push({
      key: `calendar:fragmented:${isoDate(startOfWeek(now, weekStartsOn))}`,
      category: "calendar",
      severity: "normal",
      title: "Your week is fragmented",
      why: `${weekAnalytics.fragmentedDays.length} days have meetings split by gaps too short to use for real work.`,
      href: "/calendar",
      askPrompt: "My meetings are fragmenting my days. How could I consolidate them?",
    });
  }

  /* ------------------------------------------------------------ health */

  if (sleep.hasData && sleep.direction === "down" && sleep.delta !== null && sleep.delta <= -20) {
    signals.push({
      key: "health:sleep-decline",
      category: "health",
      severity: sleep.delta <= -45 ? "high" : "normal",
      title: "Your sleep has dropped",
      why: `The last 7 nights averaged ${formatDuration(sleep.recentAverage)}, ${formatDuration(
        Math.abs(sleep.delta),
      )} less than the week before.`,
      href: "/health",
      askPrompt: "My sleep has dropped recently. What in my calendar or habits might explain it?",
    });
  }

  /* ----------------------------------------------------------- finance */

  for (const anomaly of anomalies.slice(0, 2)) {
    signals.push({
      key: `finance:anomaly:${anomaly.category}`,
      category: "finance",
      severity: "normal",
      title: `${anomaly.label} spending is up`,
      why: `${pct(anomaly.changePct, 0)} above your 3-month average for this category.`,
      href: "/finances",
      askPrompt: `My ${anomaly.label.toLowerCase()} spending is above average. Show me what changed.`,
    });
  }

  /* ----------------------------------------------------- relationships */

  for (const person of overdueContacts.slice(0, 2)) {
    signals.push({
      key: `relationships:overdue:${person.id}`,
      category: "relationships",
      severity: "normal",
      // Phrased as a suggestion: elapsed time is not proof anything is wrong.
      title: `It has been a while with ${person.name}`,
      why: `Last contact was ${person.daysSinceContact} days ago, and you set a ${person.cadenceDays}-day cadence for them.`,
      href: "/relationships",
      askPrompt: `Help me think of a good reason to reach out to ${person.name}.`,
      suggestedTask: `Reach out to ${person.name}`,
    });
  }

  for (const person of upcomingDates.slice(0, 2)) {
    if (person.daysUntilBirthday === null || person.daysUntilBirthday > 14) continue;
    signals.push({
      key: `relationships:birthday:${person.id}:${new Date().getFullYear()}`,
      category: "relationships",
      severity: person.daysUntilBirthday <= 3 ? "high" : "normal",
      title: `${person.name}'s birthday is ${person.daysUntilBirthday === 0 ? "today" : `in ${person.daysUntilBirthday} days`}`,
      why: "You recorded this date, so it is worth a heads-up before it passes.",
      href: "/relationships",
      askPrompt: `What could I do for ${person.name}'s birthday?`,
      suggestedTask: `Plan something for ${person.name}'s birthday`,
    });
  }

  /* ------------------------------------------------------------ review */

  const lastWeekStart = isoDate(addDays(startOfWeek(now, weekStartsOn), -7));
  const hasLastWeekReview = lastReview[0]?.periodStart === lastWeekStart;
  // Only nudge once the week is genuinely over and a couple of days have passed.
  if (!hasLastWeekReview && daysBetween(startOfWeek(now, weekStartsOn), now) >= 1) {
    signals.push({
      key: `system:weekly-review:${lastWeekStart}`,
      category: "system",
      severity: "normal",
      title: "Last week has not been reviewed",
      why: "A weekly review is what keeps the rest of this useful. It takes about five minutes.",
      href: "/reviews?generate=weekly",
      askPrompt: "Review my week for me.",
    });
  }

  /* ------------------------------------------------- dismissals & order */

  const suppressed = new Map(dismissals.map((d) => [d.signalKey, d]));
  return signals
    .filter((s) => {
      const record = suppressed.get(s.key);
      if (!record) return true;
      if (record.snoozedUntil && record.snoozedUntil > now) return false;
      // A dismissal without a snooze hides the signal until it recurs anew.
      return !record.dismissedAt || Boolean(record.snoozedUntil && record.snoozedUntil <= now);
    })
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

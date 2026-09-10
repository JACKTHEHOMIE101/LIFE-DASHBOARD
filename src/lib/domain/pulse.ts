import "server-only";

import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, interactions, lifeAreas, notes, tasks } from "@/db/schema";
import { addDays, formatDuration, mean, pct, startOfDay } from "@/lib/utils";
import { getSpendingAnomalies, getTrailingCashflow } from "./finances";
import { getMetricTrend, getWorkoutStats } from "./health";
import { listGoals } from "./goals";
import { listHabits } from "./habits";
import { listProjects } from "./projects";
import { getRelationshipsNeedingAttention } from "./relationships";

/**
 * Life Pulse.
 *
 * The brief is explicit that this must not invent precision. So there is no
 * 0-100 "life score" here. Each area is judged by a handful of concrete,
 * named signals; the status is a band derived from how many of those signals
 * are healthy, and every signal that fed the result is listed in the UI along
 * with the rule that produced it.
 *
 * A signal with no data contributes nothing rather than counting as a zero,
 * and an area with no signals at all reports "Not tracked yet".
 */

export type SignalVerdict = "good" | "neutral" | "poor";

export type PulseSignal = {
  label: string;
  /** What was actually measured, e.g. "7h 24m average". */
  value: string;
  /** Movement against the previous comparable window, when one exists. */
  change?: string | null;
  verdict: SignalVerdict;
  direction: "up" | "down" | "flat";
  goodDirection: "up" | "down" | "neutral";
};

export type PulseStatus = "strong" | "steady" | "attention" | "no_data";

export type AreaPulse = {
  areaId: string;
  slug: string;
  name: string;
  color: string;
  status: PulseStatus;
  statusLabel: string;
  /** One line summarising the most informative signal. */
  headline: string;
  signals: PulseSignal[];
  /** Plain description of how this area is measured, shown on demand. */
  methodology: string[];
};

const STATUS_LABEL: Record<PulseStatus, string> = {
  strong: "Strong",
  steady: "Steady",
  attention: "Needs attention",
  no_data: "Not tracked yet",
};

export function statusLabel(status: PulseStatus) {
  return STATUS_LABEL[status];
}

const VERDICT_VALUE: Record<SignalVerdict, number> = { good: 1, neutral: 0.5, poor: 0 };

/** Bands are fixed and documented rather than tuned to look flattering. */
function bandFor(signals: PulseSignal[]): PulseStatus {
  if (signals.length === 0) return "no_data";
  const score = mean(signals.map((s) => VERDICT_VALUE[s.verdict]));
  if (score >= 0.7) return "strong";
  if (score >= 0.45) return "steady";
  return "attention";
}

function signal(
  label: string,
  value: string,
  verdict: SignalVerdict,
  options: {
    change?: string | null;
    direction?: "up" | "down" | "flat";
    goodDirection?: "up" | "down" | "neutral";
  } = {},
): PulseSignal {
  return {
    label,
    value,
    change: options.change ?? null,
    verdict,
    direction: options.direction ?? "flat",
    goodDirection: options.goodDirection ?? "up",
  };
}

/* ------------------------------------------------------- per-area models */

async function healthSignals(userId: string): Promise<[PulseSignal[], string[]]> {
  const [sleep, workouts, habits] = await Promise.all([
    getMetricTrend(userId, "sleep_minutes"),
    getWorkoutStats(userId),
    listHabits(userId),
  ]);

  const signals: PulseSignal[] = [];

  if (sleep.hasData && sleep.recentAverage !== null) {
    // Seven hours is the line; the trend decides between good and neutral.
    const verdict: SignalVerdict =
      sleep.recentAverage >= 420 && sleep.direction !== "down"
        ? "good"
        : sleep.recentAverage >= 390
          ? "neutral"
          : "poor";
    signals.push(
      signal("Sleep", `${formatDuration(sleep.recentAverage)} average`, verdict, {
        change: sleep.deltaFormatted ? `${sleep.deltaFormatted} vs prior week` : null,
        direction: sleep.direction,
        goodDirection: "up",
      }),
    );
  }

  if (workouts.hasData) {
    const verdict: SignalVerdict =
      workouts.perWeek >= 3 ? "good" : workouts.perWeek >= 1.5 ? "neutral" : "poor";
    const delta = workouts.count - workouts.priorCount;
    signals.push(
      signal("Training", `${workouts.perWeek} per week`, verdict, {
        change: delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} vs prior 4 weeks` : null,
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      }),
    );
  }

  const healthHabits = habits.filter((h) => h.areaName === "Health");
  if (healthHabits.length) {
    const consistency = mean(healthHabits.map((h) => h.consistency));
    signals.push(
      signal(
        "Health habits",
        `${Math.round(consistency * 100)}% consistency`,
        consistency >= 0.7 ? "good" : consistency >= 0.4 ? "neutral" : "poor",
      ),
    );
  }

  return [
    signals,
    [
      "Sleep: 7-day average against the 7 days before it. Good at 7h or more and not falling.",
      "Training: workouts per week over the last 4 weeks. Good at 3 or more.",
      "Health habits: share of the last 30 days completed for habits filed under Health.",
    ],
  ];
}

async function moneySignals(userId: string): Promise<[PulseSignal[], string[]]> {
  const [trailing, anomalies] = await Promise.all([
    getTrailingCashflow(userId),
    getSpendingAnomalies(userId),
  ]);

  const signals: PulseSignal[] = [];

  if (trailing.savingsRate !== null) {
    const rate = trailing.savingsRate;
    const delta =
      trailing.priorSavingsRate !== null ? (rate - trailing.priorSavingsRate) * 100 : null;
    signals.push(
      signal(
        "Savings rate",
        `${Math.round(rate * 100)}% over 30 days`,
        rate >= 0.2 ? "good" : rate >= 0.05 ? "neutral" : "poor",
        {
          change: delta !== null ? `${pct(delta, 0)} vs prior 30 days` : null,
          direction: delta === null || Math.abs(delta) < 1 ? "flat" : delta > 0 ? "up" : "down",
        },
      ),
    );
  }

  if (anomalies.length > 0) {
    const worst = anomalies[0];
    signals.push(
      signal("Spending", `${worst.label} ${pct(worst.changePct, 0)} above average`, "poor", {
        direction: "up",
        goodDirection: "down",
      }),
    );
  } else if (trailing.hasData) {
    signals.push(signal("Spending", "In line with your average", "good", { goodDirection: "down" }));
  }

  return [
    signals,
    [
      "Savings rate: (income minus spending) divided by income over the last 30 days, compared with the 30 before. A trailing window rather than the calendar month, so a partial month does not read as zero income. Good at 20% or more.",
      "Spending: any category more than 20% above its own baseline, where the baseline is the average of the three 30-day windows before this one. Ignores anything under $50.",
    ],
  ];
}

async function careerSignals(userId: string, areaId: string): Promise<[PulseSignal[], string[]]> {
  const [projects, completed] = await Promise.all([
    listProjects(userId, { statuses: ["active"], lifeAreaId: areaId }),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.lifeAreaId, areaId),
          eq(tasks.status, "done"),
          gte(tasks.completedAt, addDays(new Date(), -7)),
        ),
      ),
  ]);

  const signals: PulseSignal[] = [];
  const doneThisWeek = completed[0]?.n ?? 0;
  const stalled = projects.filter((p) => p.isStalled);

  if (projects.length > 0) {
    signals.push(
      signal(
        "Project momentum",
        stalled.length === 0
          ? `${projects.length} active, all moving`
          : `${stalled.length} of ${projects.length} stalled`,
        stalled.length === 0 ? "good" : stalled.length < projects.length / 2 ? "neutral" : "poor",
      ),
    );
  }

  if (projects.length > 0 || doneThisWeek > 0) {
    signals.push(
      signal(
        "Completed this week",
        `${doneThisWeek} ${doneThisWeek === 1 ? "task" : "tasks"}`,
        doneThisWeek >= 5 ? "good" : doneThisWeek >= 2 ? "neutral" : "poor",
      ),
    );
  }

  return [
    signals,
    [
      "Project momentum: active projects in this area, and how many have had no activity for 14 days.",
      "Completed this week: tasks in this area finished in the last 7 days. Good at 5 or more.",
    ],
  ];
}

async function relationshipSignals(userId: string): Promise<[PulseSignal[], string[]]> {
  const [recent, prior, overdue] = await Promise.all([
    db
      .select({ n: count() })
      .from(interactions)
      .where(
        and(eq(interactions.userId, userId), gte(interactions.occurredAt, addDays(new Date(), -30))),
      ),
    db
      .select({ n: count() })
      .from(interactions)
      .where(
        and(
          eq(interactions.userId, userId),
          gte(interactions.occurredAt, addDays(new Date(), -60)),
          sql`${interactions.occurredAt} < ${addDays(new Date(), -30).getTime()}`,
        ),
      ),
    getRelationshipsNeedingAttention(userId, 10),
  ]);

  const recentCount = recent[0]?.n ?? 0;
  const priorCount = prior[0]?.n ?? 0;
  if (recentCount === 0 && priorCount === 0 && overdue.length === 0) return [[], []];

  const delta = recentCount - priorCount;
  const signals: PulseSignal[] = [
    signal(
      "Time together",
      `${recentCount} in the last 30 days`,
      recentCount >= 8 ? "good" : recentCount >= 3 ? "neutral" : "poor",
      {
        change: delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} vs prior 30 days` : null,
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      },
    ),
  ];

  if (overdue.length > 0) {
    signals.push(
      signal(
        "Overdue check-ins",
        `${overdue.length} past your own cadence`,
        overdue.length <= 1 ? "neutral" : "poor",
        { goodDirection: "down" },
      ),
    );
  }

  return [
    signals,
    [
      "Time together: recorded interactions in the last 30 days against the 30 before it.",
      "Overdue check-ins: people you set a contact cadence for where that gap has passed. People with no cadence are never counted.",
    ],
  ];
}

async function growthSignals(userId: string, areaId: string): Promise<[PulseSignal[], string[]]> {
  const [habits, goals, noteCount] = await Promise.all([
    listHabits(userId),
    listGoals(userId, { statuses: ["active"], lifeAreaId: areaId }),
    db
      .select({ n: count() })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          eq(notes.lifeAreaId, areaId),
          isNull(notes.deletedAt),
          gte(notes.createdAt, addDays(new Date(), -30)),
        ),
      ),
  ]);

  const signals: PulseSignal[] = [];
  const areaHabits = habits.filter((h) => h.lifeAreaId === areaId);

  if (areaHabits.length) {
    const consistency = mean(areaHabits.map((h) => h.consistency));
    signals.push(
      signal(
        "Practice",
        `${Math.round(consistency * 100)}% consistency`,
        consistency >= 0.6 ? "good" : consistency >= 0.3 ? "neutral" : "poor",
      ),
    );
  }

  if (goals.length) {
    const neglected = goals.filter((g) => g.isNeglected).length;
    signals.push(
      signal(
        "Goal activity",
        neglected === 0 ? `${goals.length} active, all moving` : `${neglected} without recent progress`,
        neglected === 0 ? "good" : "poor",
        { goodDirection: "down" },
      ),
    );
  }

  const notes30 = noteCount[0]?.n ?? 0;
  if (notes30 > 0) {
    signals.push(signal("Captured thinking", `${notes30} notes in 30 days`, "good"));
  }

  return [
    signals,
    [
      "Practice: 30-day completion rate of habits filed under this area.",
      "Goal activity: active goals here with no recorded progress in 21 days.",
      "Captured thinking: notes filed under this area in the last 30 days.",
    ],
  ];
}

async function experienceSignals(userId: string): Promise<[PulseSignal[], string[]]> {
  const rows = await db
    .select({ n: count() })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        isNull(events.deletedAt),
        gte(events.startsAt, addDays(new Date(), -30)),
        sql`${events.category} in ('social','travel')`,
      ),
    );

  const n = rows[0]?.n ?? 0;
  if (n === 0) return [[], []];

  return [
    [signal("Getting out", `${n} in the last 30 days`, n >= 6 ? "good" : n >= 2 ? "neutral" : "poor")],
    ["Getting out: calendar events categorised as social or travel in the last 30 days."],
  ];
}

/** Fallback for custom areas: judge them by their own tasks and goals. */
async function genericSignals(userId: string, areaId: string): Promise<[PulseSignal[], string[]]> {
  const [openRows, doneRows, goals] = await Promise.all([
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.lifeAreaId, areaId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} in ('todo','in_progress','blocked')`,
        ),
      ),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.lifeAreaId, areaId),
          eq(tasks.status, "done"),
          gte(tasks.completedAt, addDays(new Date(), -30)),
        ),
      ),
    listGoals(userId, { statuses: ["active"], lifeAreaId: areaId }),
  ]);

  const open = openRows[0]?.n ?? 0;
  const done = doneRows[0]?.n ?? 0;
  if (open === 0 && done === 0 && goals.length === 0) return [[], []];

  const signals: PulseSignal[] = [
    signal(
      "Recent progress",
      `${done} completed in 30 days`,
      done >= 4 ? "good" : done >= 1 ? "neutral" : "poor",
    ),
  ];
  if (open > 0) {
    signals.push(
      signal("Open work", `${open} open`, open <= 5 ? "good" : open <= 12 ? "neutral" : "poor", {
        goodDirection: "down",
      }),
    );
  }

  return [
    signals,
    [
      "Recent progress: tasks in this area completed in the last 30 days.",
      "Open work: tasks still open in this area. A large backlog reads as needing attention.",
    ],
  ];
}

/* ------------------------------------------------------------------ pulse */

export async function getLifePulse(userId: string): Promise<AreaPulse[]> {
  const areas = await db
    .select()
    .from(lifeAreas)
    .where(
      and(eq(lifeAreas.userId, userId), isNull(lifeAreas.archivedAt), isNull(lifeAreas.deletedAt)),
    )
    .orderBy(lifeAreas.sortOrder);

  const results = await Promise.all(
    areas.map(async (area): Promise<AreaPulse> => {
      let signals: PulseSignal[] = [];
      let methodology: string[] = [];

      switch (area.slug) {
        case "health":
          [signals, methodology] = await healthSignals(userId);
          break;
        case "money":
          [signals, methodology] = await moneySignals(userId);
          break;
        case "career":
          [signals, methodology] = await careerSignals(userId, area.id);
          break;
        case "relationships":
        case "family":
          [signals, methodology] = await relationshipSignals(userId);
          break;
        case "personal-growth":
          [signals, methodology] = await growthSignals(userId, area.id);
          break;
        case "experiences":
          [signals, methodology] = await experienceSignals(userId);
          break;
        default:
          [signals, methodology] = await genericSignals(userId, area.id);
      }

      const status = bandFor(signals);
      const lead = signals.find((s) => s.verdict === "poor") ?? signals[0];

      return {
        areaId: area.id,
        slug: area.slug,
        name: area.name,
        color: area.color,
        status,
        statusLabel: STATUS_LABEL[status],
        headline: lead ? `${lead.value}` : "Nothing recorded here yet",
        signals,
        methodology,
      };
    }),
  );

  // Areas with data first; the untracked ones sink to the bottom rather than
  // padding the top of the dashboard with blanks.
  return results.sort((a, b) => Number(a.status === "no_data") - Number(b.status === "no_data"));
}

/** Direction for the whole area, derived from its signals rather than declared. */
export function areaDirection(pulse: AreaPulse): "up" | "down" | "flat" {
  const moving = pulse.signals.filter((s) => s.direction !== "flat");
  if (moving.length === 0) return "flat";
  const good = moving.filter(
    (s) => s.goodDirection !== "neutral" && s.direction === s.goodDirection,
  ).length;
  const bad = moving.length - good;
  if (good > bad) return "up";
  if (bad > good) return "down";
  return "flat";
}

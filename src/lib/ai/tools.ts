import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { getAttentionSignals } from "@/lib/domain/attention";
import {
  analyseEvents, findFreeSlots, getEventsBetween, getTodayEvents,
} from "@/lib/domain/calendar";
import { getFinanceOverview } from "@/lib/domain/finances";
import { listGoals } from "@/lib/domain/goals";
import { listHabits } from "@/lib/domain/habits";
import { getHealthOverview, getWorkoutStats } from "@/lib/domain/health";
import { listProjects } from "@/lib/domain/projects";
import { getRelationshipsNeedingAttention, getUpcomingDates } from "@/lib/domain/relationships";
import { globalSearch } from "@/lib/domain/search";
import { getTaskCounts, listTasks } from "@/lib/domain/tasks";
import { getTimeAnalytics } from "@/lib/domain/analytics";
import { addDays, formatDuration, formatMoney, isoDate, startOfDay } from "@/lib/utils";

/**
 * The Chief of Staff reads the Life OS through these tools rather than being
 * handed one giant context blob. Two properties matter:
 *
 *  1. Every tool is scoped to one userId, bound at construction. The model
 *     cannot widen that scope, because the userId is never part of any schema.
 *  2. Read tools and write tools are separated. Write tools never mutate here;
 *     they return a proposal that the user has to confirm in the UI.
 */

export type ToolProposal = {
  id: string;
  kind: "create_task" | "schedule_event" | "move_deadline" | "create_note";
  summary: string;
  payload: Record<string, unknown>;
};

export type ToolRunResult = {
  content: string;
  citation?: { label: string; source: string; detail?: string };
  proposal?: ToolProposal;
};

const readTools: Anthropic.Tool[] = [
  {
    name: "get_today",
    description:
      "Today's open priorities, task counts, calendar and remaining free time. Start here for questions about today, what to do next, or planning the day.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_tasks",
    description:
      "List tasks. Use view=overdue for what is slipping, and max_minutes to find work that fits a specific window.",
    input_schema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["today", "upcoming", "overdue", "unscheduled", "all", "completed"],
        },
        max_minutes: { type: "number", description: "Only tasks estimated at or under this." },
        energy: { type: "string", enum: ["low", "medium", "high"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_projects",
    description: "Active projects with progress, next action, deadline and whether they have stalled.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_goals",
    description: "Goals with measured progress, time elapsed against the target date, and neglect state.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_calendar",
    description: "Events and calendar analytics over a window, plus free slots on a given day.",
    input_schema: {
      type: "object",
      properties: {
        days_ahead: { type: "number", description: "How many days forward from today. Default 7." },
        days_back: { type: "number", description: "How many days back from today. Default 0." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_health",
    description:
      "Sleep, resting heart rate, HRV, steps and weight trends, plus workout frequency. Says explicitly when a metric has no data.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_finances",
    description: "Net worth, monthly cash flow, savings rate, spending by category and spending anomalies.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_relationships",
    description: "People past the contact cadence the user set, and upcoming birthdays.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_habits",
    description: "Habits with streaks and 30-day consistency.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_time_analytics",
    description:
      "Where time actually went across categories over a period, compared against the user's intended weekly budget when one is set.",
    input_schema: {
      type: "object",
      properties: { period: { type: "string", enum: ["week", "month", "quarter"] } },
      additionalProperties: false,
    },
  },
  {
    name: "get_attention_signals",
    description:
      "Everything the system has already flagged as needing attention, each with the reason it was surfaced.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search",
    description: "Free-text search across tasks, projects, goals, people, notes, journal, events and transactions.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

const writeTools: Anthropic.Tool[] = [
  {
    name: "propose_task",
    description:
      "Propose creating a task. This does NOT create it: the user sees a confirmation card and decides. Use when the user asks you to add, remind or capture something.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        estimated_minutes: { type: "number" },
        priority: { type: "string", enum: ["must", "should", "could"] },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_event",
    description:
      "Propose putting a block on the calendar, such as focus time. Requires user confirmation before anything is written.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        starts_at: { type: "string", description: "ISO 8601 local datetime" },
        duration_minutes: { type: "number" },
      },
      required: ["title", "starts_at", "duration_minutes"],
      additionalProperties: false,
    },
  },
];

export const ALL_TOOLS: Anthropic.Tool[] = [...readTools, ...writeTools];

/* ------------------------------------------------------------- execution */

function line(label: string, value: string) {
  return `${label}: ${value}`;
}

/** Runs one tool call against the given user's data. */
export async function runTool(
  userId: string,
  weekStartsOn: number,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolRunResult> {
  switch (name) {
    case "get_today": {
      const [tasks, counts, events] = await Promise.all([
        listTasks(userId, { view: "today", limit: 25 }),
        getTaskCounts(userId),
        getTodayEvents(userId),
      ]);
      const free = findFreeSlots(events, new Date(), { minMinutes: 30 }).filter(
        (s) => s.end > new Date(),
      );
      const analytics = analyseEvents(events, startOfDay(new Date()), 1);

      return {
        content: [
          line("Date", new Date().toDateString()),
          line(
            "Open tasks",
            `${counts.open} total, ${counts.overdue} overdue, ${counts.dueToday} due today, ${counts.completedToday} completed today`,
          ),
          "Due or scheduled today:",
          ...tasks.map(
            (t) =>
              `  - [${t.priority}] ${t.title}${t.estimatedMinutes ? ` (${t.estimatedMinutes}m)` : ""}${
                t.projectTitle ? ` · project: ${t.projectTitle}` : ""
              }${t.dueDate && t.dueDate < startOfDay(new Date()) ? " · OVERDUE" : ""}`,
          ),
          line("Meetings today", formatDuration(analytics.meetingMinutes) ?? "none"),
          "Remaining free slots today:",
          ...(free.length
            ? free.map(
                (s) =>
                  `  - ${s.start.toTimeString().slice(0, 5)} to ${s.end.toTimeString().slice(0, 5)} (${s.minutes}m)`,
              )
            : ["  - none left in working hours"]),
        ].join("\n"),
        citation: {
          label: "Today",
          source: "tasks + calendar",
          detail: `${counts.open} open tasks, ${counts.overdue} overdue`,
        },
      };
    }

    case "list_tasks": {
      const tasks = await listTasks(userId, {
        view: (input.view as "today") ?? "all",
        maxMinutes: typeof input.max_minutes === "number" ? input.max_minutes : undefined,
        energy: input.energy as "low" | undefined,
        limit: 40,
      });
      if (!tasks.length) return { content: "No tasks match that filter." };
      return {
        content: tasks
          .map(
            (t) =>
              `- [${t.priority}] ${t.title}${t.dueDate ? ` · due ${isoDate(t.dueDate)}` : ""}${
                t.estimatedMinutes ? ` · ${t.estimatedMinutes}m` : ""
              }${t.projectTitle ? ` · ${t.projectTitle}` : ""}`,
          )
          .join("\n"),
        citation: {
          label: `Tasks (${input.view ?? "all"})`,
          source: "tasks",
          detail: `${tasks.length} matching`,
        },
      };
    }

    case "list_projects": {
      const projects = await listProjects(userId);
      if (!projects.length) return { content: "No active projects." };
      return {
        content: projects
          .map(
            (p) =>
              `- ${p.title}: ${p.progress}% (${p.taskDone}/${p.taskTotal} tasks)${
                p.deadline ? ` · deadline ${isoDate(p.deadline)}` : ""
              } · last activity ${p.daysInactive ?? "never"} days ago${p.isStalled ? " · STALLED" : ""}${
                p.nextAction ? ` · next: ${p.nextAction.title}` : " · no next action"
              }`,
          )
          .join("\n"),
        citation: {
          label: "Projects",
          source: "projects",
          detail: `${projects.length} active, ${projects.filter((p) => p.isStalled).length} stalled`,
        },
      };
    }

    case "list_goals": {
      const goals = await listGoals(userId, { statuses: ["active"] });
      if (!goals.length) return { content: "No active goals." };
      return {
        content: goals
          .map(
            (g) =>
              `- ${g.title}: ${g.progress !== null ? `${Math.round(g.progress * 100)}% complete` : "no metric set"}${
                g.timeElapsed !== null ? `, ${Math.round(g.timeElapsed * 100)}% of time elapsed` : ""
              }${g.currentValue !== null && g.targetValue !== null ? ` (${g.currentValue} of ${g.targetValue} ${g.metricUnit ?? ""})` : ""} · last progress ${
                g.daysSinceProgress ?? "never"
              } days ago${g.isNeglected ? " · NEGLECTED" : ""}${g.behindSchedule ? " · BEHIND SCHEDULE" : ""}`,
          )
          .join("\n"),
        citation: { label: "Goals", source: "goals", detail: `${goals.length} active` },
      };
    }

    case "get_calendar": {
      const back = typeof input.days_back === "number" ? input.days_back : 0;
      const ahead = typeof input.days_ahead === "number" ? input.days_ahead : 7;
      const from = startOfDay(addDays(new Date(), -back));
      const to = addDays(from, back + ahead);
      const events = await getEventsBetween(userId, from, to);
      const analytics = analyseEvents(events, from, back + ahead);

      return {
        content: [
          line("Window", `${isoDate(from)} to ${isoDate(to)}`),
          line("Events", String(analytics.totalEvents)),
          line("Meetings", formatDuration(analytics.meetingMinutes) ?? "0m"),
          line("Focus blocks", formatDuration(analytics.focusMinutes) ?? "0m"),
          line("Unbooked weekday time", formatDuration(analytics.freeMinutes) ?? "0m"),
          analytics.overloadedDays.length
            ? `Overloaded days: ${analytics.overloadedDays.map((d) => `${d.date.toDateString()} (${formatDuration(d.meetingMinutes)} of meetings)`).join(", ")}`
            : "No overloaded days.",
          analytics.fragmentedDays.length
            ? `Fragmented days: ${analytics.fragmentedDays.map((d) => `${d.date.toDateString()} (${d.gaps} unusable gaps)`).join(", ")}`
            : "No fragmented days.",
          "Free slots per upcoming day:",
          ...Array.from({ length: Math.min(ahead, 5) }, (_, i) => {
            const day = addDays(startOfDay(new Date()), i);
            const slots = findFreeSlots(events, day, { minMinutes: 45 });
            return `  - ${day.toDateString()}: ${
              slots.length
                ? slots.map((s) => `${s.start.toTimeString().slice(0, 5)}-${s.end.toTimeString().slice(0, 5)} (${s.minutes}m)`).join(", ")
                : "no open blocks"
            }`;
          }),
        ].join("\n"),
        citation: {
          label: "Calendar",
          source: "events",
          detail: `${formatDuration(analytics.meetingMinutes)} of meetings across ${ahead} days`,
        },
      };
    }

    case "get_health": {
      const [metrics, workouts] = await Promise.all([
        getHealthOverview(userId),
        getWorkoutStats(userId),
      ]);
      const withData = metrics.filter((m) => m.hasData);
      if (!withData.length && !workouts.hasData) {
        return {
          content:
            "No health data is connected. There are no sleep, heart rate, HRV, step or weight readings in this Life OS.",
        };
      }
      return {
        content: [
          ...metrics.map((m) =>
            m.hasData
              ? `${m.label}: ${m.formatted} (7-day average)${
                  m.deltaFormatted ? `, ${m.deltaFormatted} versus the prior 7 days` : ", flat versus the prior 7 days"
                }`
              : `${m.label}: no data connected`,
          ),
          workouts.hasData
            ? `Workouts: ${workouts.count} in the last 28 days (${workouts.perWeek} per week), ${workouts.priorCount} in the 28 days before that`
            : "Workouts: none recorded",
        ].join("\n"),
        citation: {
          label: "Health",
          source: "metrics",
          detail: withData.map((m) => `${m.label} ${m.formatted}`).join(", "),
        },
      };
    }

    case "get_finances": {
      const f = await getFinanceOverview(userId);
      if (!f.netWorth.hasData) {
        return { content: "No financial accounts are connected, so there is nothing to report." };
      }
      return {
        content: [
          line("Net worth", formatMoney(f.netWorth.netMinor)),
          line(
            "Assets and liabilities",
            `${formatMoney(f.netWorth.assetsMinor)} assets, ${formatMoney(f.netWorth.liabilitiesMinor)} liabilities`,
          ),
          f.current
            ? line(
                "This month",
                `${formatMoney(f.current.incomeMinor)} in, ${formatMoney(f.current.expenseMinor)} out, savings rate ${
                  f.current.savingsRate !== null ? `${Math.round(f.current.savingsRate * 100)}%` : "unknown"
                }`,
              )
            : "No transactions this month.",
          "Top spending categories over 30 days:",
          ...f.categories
            .slice(0, 6)
            .map(
              (c) =>
                `  - ${c.label}: ${formatMoney(c.amountMinor)}${
                  c.changePct !== null ? ` (${c.changePct >= 0 ? "+" : ""}${Math.round(c.changePct)}% vs 3-month average)` : " (no baseline yet)"
                }`,
            ),
          f.anomalies.length
            ? `Anomalies: ${f.anomalies.map((a) => `${a.label} is ${Math.round(a.changePct)}% above its 3-month average`).join("; ")}`
            : "No spending anomalies.",
        ].join("\n"),
        citation: {
          label: "Finances",
          source: "accounts + transactions",
          detail: `Net worth ${formatMoney(f.netWorth.netMinor)}`,
        },
      };
    }

    case "get_relationships": {
      const [overdue, birthdays] = await Promise.all([
        getRelationshipsNeedingAttention(userId, 10),
        getUpcomingDates(userId, 30),
      ]);
      if (!overdue.length && !birthdays.length) {
        return { content: "Nobody is past the contact cadence set for them, and no birthdays are within 30 days." };
      }
      return {
        content: [
          overdue.length ? "Past their cadence:" : "Nobody is past their cadence.",
          ...overdue.map(
            (p) =>
              `  - ${p.name} (${p.relationshipType}): last contact ${p.daysSinceContact} days ago, cadence ${p.cadenceDays} days`,
          ),
          birthdays.length ? "Upcoming dates:" : "",
          ...birthdays.map((p) => `  - ${p.name}: birthday in ${p.daysUntilBirthday} days`),
        ]
          .filter(Boolean)
          .join("\n"),
        citation: {
          label: "Relationships",
          source: "people",
          detail: `${overdue.length} past cadence`,
        },
      };
    }

    case "get_habits": {
      const habits = await listHabits(userId);
      if (!habits.length) return { content: "No habits are being tracked." };
      return {
        content: habits
          .map(
            (h) =>
              `- ${h.name} (${h.frequency}): ${Math.round(h.consistency * 100)}% consistency over 30 days, current streak ${h.streak}, ${h.doneToday ? "done today" : "not done today"}`,
          )
          .join("\n"),
        citation: { label: "Habits", source: "habits", detail: `${habits.length} tracked` },
      };
    }

    case "get_time_analytics": {
      const period = (input.period as "week" | "month" | "quarter") ?? "week";
      const analytics = await getTimeAnalytics(userId, period, weekStartsOn);
      return {
        content: [
          line("Period", `${period} starting ${isoDate(analytics.from)}`),
          ...analytics.categories.map(
            (c) =>
              `${c.label}: ${formatDuration(c.actualMinutes)}${
                c.intendedMinutes !== null
                  ? ` actual against ${formatDuration(c.intendedMinutes)} intended`
                  : " (no intention set)"
              }`,
          ),
          analytics.categories.every((c) => c.actualMinutes === 0)
            ? "No time data recorded for this period."
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        citation: {
          label: "Time",
          source: "calendar + focus sessions",
          detail: `${period} breakdown`,
        },
      };
    }

    case "get_attention_signals": {
      const signals = await getAttentionSignals(userId, weekStartsOn);
      if (!signals.length) return { content: "Nothing is currently flagged." };
      return {
        content: signals.map((s) => `- [${s.severity}] ${s.title} — ${s.why}`).join("\n"),
        citation: {
          label: "Attention",
          source: "signals",
          detail: `${signals.length} flagged`,
        },
      };
    }

    case "search": {
      const hits = await globalSearch(userId, String(input.query ?? ""));
      if (!hits.length) return { content: `Nothing matches "${input.query}".` };
      return {
        content: hits.map((h) => `- [${h.type}] ${h.title}${h.subtitle ? ` (${h.subtitle})` : ""}`).join("\n"),
        citation: { label: `Search: ${input.query}`, source: "all records", detail: `${hits.length} matches` },
      };
    }

    /* ----------------------------------------------------- write proposals */

    case "propose_task": {
      const title = String(input.title ?? "").trim();
      if (!title) return { content: "A task needs a title." };
      const proposal: ToolProposal = {
        id: crypto.randomUUID(),
        kind: "create_task",
        summary: `Create task: "${title}"${input.due_date ? ` due ${input.due_date}` : ""}`,
        payload: {
          title,
          dueDate: input.due_date ?? null,
          estimatedMinutes: input.estimated_minutes ?? null,
          priority: input.priority ?? "should",
        },
      };
      return {
        content:
          "Proposed to the user as a confirmation card. It has NOT been created. Tell the user what you proposed and that they need to confirm it.",
        proposal,
      };
    }

    case "propose_event": {
      const title = String(input.title ?? "").trim();
      const startsAt = String(input.starts_at ?? "");
      if (!title || !startsAt) return { content: "An event needs a title and a start time." };
      const proposal: ToolProposal = {
        id: crypto.randomUUID(),
        kind: "schedule_event",
        summary: `Schedule "${title}" at ${new Date(startsAt).toLocaleString("en-GB")} for ${input.duration_minutes}m`,
        payload: { title, startsAt, durationMinutes: input.duration_minutes ?? 60 },
      };
      return {
        content:
          "Proposed to the user as a confirmation card. Nothing has been added to the calendar yet.",
        proposal,
      };
    }

    default:
      return { content: `Unknown tool: ${name}` };
  }
}

export function buildSystemPrompt(userName: string, weekStartsOn: number) {
  const now = new Date();
  return `You are the Chief of Staff inside ${userName}'s personal Life OS.

Today is ${now.toDateString()}. The working week starts on ${weekStartsOn === 1 ? "Monday" : "Sunday"}.

Your job is to reduce cognitive load, not add to it. Be concise, concrete and calm.

HOW TO ANSWER
- Always look at the data before answering. Call tools; never answer a factual question about ${userName}'s life from memory or assumption.
- Cite the numbers you used, in the user's own units. "Your sleep averaged 6h 40m over the last 7 nights, down 42m from the week before" is useful; "your sleep is down" is not.
- Distinguish clearly between the three kinds of statement you can make:
    Observation — something the data says outright.
    Inference — something you conclude from the data, which could be wrong. Mark it as such ("this suggests", "it looks like").
    Recommendation — what you think ${userName} should do.
  Never present an inference or a recommendation as an observation.
- If the data needed to answer is not there, say exactly that: "I don't have that data connected yet." Never estimate, illustrate or invent a number, and never describe a hypothetical example as if it were real.
- Lead with the answer. Two or three short paragraphs, or a short list. No preamble, no restating the question.
- Recommend at most 3 to 5 things. A long list is the problem you exist to solve.

ACTIONS
- You cannot write to the Life OS directly. propose_task and propose_event create a confirmation card that ${userName} must accept. After proposing, say plainly what you proposed and that it needs confirming.
- Never claim something has been created, scheduled or changed. It has not been, until they confirm.

TONE
- Direct and warm. No hype, no motivational filler, no exclamation marks.
- ${userName} is an adult who knows their own life. Offer judgement, not lectures. Where a signal is ambiguous, say so.`;
}

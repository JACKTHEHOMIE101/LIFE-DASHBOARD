/**
 * Turns one line of typed text into a proposed Life OS object.
 *
 * This is deliberately deterministic and dependency-free: capture has to work
 * instantly, offline, and without an API key. The AI layer can refine a result
 * afterwards, but it is never on the critical path of writing something down.
 *
 * Confidence is reported honestly so the UI can ask instead of guessing: any
 * result below `CONFIRM_THRESHOLD` is presented as a question.
 */

export type CaptureType = "task" | "event" | "note" | "idea" | "journal" | "goal" | "project";

export type ParsedCapture = {
  type: CaptureType;
  /** 0 to 1. Below CONFIRM_THRESHOLD the UI asks the user to confirm. */
  confidence: number;
  title: string;
  body?: string;
  dueDate?: Date;
  startsAt?: Date;
  endsAt?: Date;
  estimatedMinutes?: number;
  priority?: "must" | "should" | "could";
  /** Other readings worth offering, best first. */
  alternatives: CaptureType[];
  /** Human-readable account of what was understood, shown under the input. */
  explanation: string[];
};

export const CONFIRM_THRESHOLD = 0.75;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function atMidnight(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86_400_000);
}

/* ------------------------------------------------------------------- dates */

type DateMatch = { date: Date; matched: string; hasTime: boolean };

function matchDate(input: string, now: Date): DateMatch | null {
  const text = input.toLowerCase();
  const today = atMidnight(now);

  const relative: [RegExp, number][] = [
    [/\btoday\b/, 0],
    [/\btomorrow\b/, 1],
    [/\btmr\b/, 1],
    [/\bday after tomorrow\b/, 2],
    [/\bnext week\b/, 7],
  ];
  for (const [re, offset] of relative) {
    const m = text.match(re);
    if (m) return { date: addDays(today, offset), matched: m[0], hasTime: false };
  }

  const inDays = text.match(/\bin (\d+) (day|days|week|weeks)\b/);
  if (inDays) {
    const n = Number(inDays[1]) * (inDays[2].startsWith("week") ? 7 : 1);
    return { date: addDays(today, n), matched: inDays[0], hasTime: false };
  }

  // "on monday" / "next friday" resolve to the next occurrence, never today.
  const weekday = text.match(/\b(?:on |next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1]);
    let delta = (target - today.getDay() + 7) % 7;
    if (delta === 0 || /next /.test(weekday[0])) delta = delta === 0 ? 7 : delta;
    return { date: addDays(today, delta), matched: weekday[0], hasTime: false };
  }

  const explicit = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (explicit) {
    return {
      date: new Date(Number(explicit[1]), Number(explicit[2]) - 1, Number(explicit[3])),
      matched: explicit[0],
      hasTime: false,
    };
  }

  return null;
}

type TimeMatch = { hours: number; minutes: number; matched: string };

function matchTime(input: string): TimeMatch | null {
  const text = input.toLowerCase();

  const ampm = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ampm) {
    let hours = Number(ampm[1]) % 12;
    if (ampm[3] === "pm") hours += 12;
    return { hours, minutes: Number(ampm[2] ?? 0), matched: ampm[0] };
  }

  const h24 = text.match(/\bat\s+(\d{1,2}):(\d{2})\b/) ?? text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (h24) {
    const hours = Number(h24[1]);
    if (hours <= 23) return { hours, minutes: Number(h24[2]), matched: h24[0] };
  }

  // Bare "at 6" is a time; a bare number on its own is not.
  const bare = text.match(/\bat\s+(\d{1,2})\b/);
  if (bare) {
    const raw = Number(bare[1]);
    if (raw <= 23) {
      // Assume waking hours: "at 6" means 18:00, not 06:00.
      const hours = raw >= 1 && raw <= 7 ? raw + 12 : raw;
      return { hours, minutes: 0, matched: bare[0] };
    }
  }
  return null;
}

function matchDuration(input: string): { minutes: number; matched: string } | null {
  const m = input.toLowerCase().match(/\bfor\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return { minutes: m[2].startsWith("h") ? n * 60 : n, matched: m[0] };
}

/* ------------------------------------------------------------------- parse */

function strip(text: string, ...fragments: (string | undefined)[]) {
  let out = text;
  for (const fragment of fragments) {
    if (!fragment) continue;
    const index = out.toLowerCase().indexOf(fragment.toLowerCase());
    if (index >= 0) out = out.slice(0, index) + out.slice(index + fragment.length);
  }
  return out.replace(/\s{2,}/g, " ").trim().replace(/[,\s]+$/, "");
}

export function parseCapture(raw: string, now: Date = new Date()): ParsedCapture {
  const input = raw.trim();
  const explanation: string[] = [];

  if (!input) {
    return { type: "task", confidence: 0, title: "", alternatives: [], explanation: [] };
  }

  // An explicit prefix is the user telling us the type outright.
  const prefix = input.match(/^(journal|note|idea|goal|project|task|event|remember)\s*[:\-]\s*(.+)$/i);
  if (prefix) {
    const keyword = prefix[1].toLowerCase();
    const rest = prefix[2].trim();
    const type: CaptureType =
      keyword === "remember" ? "note" : (keyword as CaptureType);
    return {
      type,
      confidence: 0.98,
      title: type === "journal" ? `Journal entry` : rest.slice(0, 120),
      body: type === "journal" || type === "note" || type === "idea" ? rest : undefined,
      alternatives: [],
      explanation: [`Read as a ${type} because the line starts with "${prefix[1]}:".`],
    };
  }

  if (/^remember (that )?/i.test(input)) {
    const rest = input.replace(/^remember (that )?/i, "").trim();
    return {
      type: "note",
      confidence: 0.85,
      title: rest.slice(0, 120),
      body: rest,
      alternatives: ["task"],
      explanation: ['"Remember" reads as something to keep, not something to do.'],
    };
  }

  const date = matchDate(input, now);
  const time = matchTime(input);
  const duration = matchDuration(input);

  let title = strip(input, date?.matched, time?.matched, duration?.matched);

  let priority: ParsedCapture["priority"];
  if (/(^|\s)!{1,3}(\s|$)/.test(title) || /\b(urgent|asap|must)\b/i.test(title)) {
    priority = "must";
    title = title.replace(/(^|\s)!{1,3}(\s|$)/g, " ").replace(/\b(urgent|asap)\b/gi, "").trim();
    explanation.push("Marked as a must-do.");
  }

  if (date) explanation.push(`Date read as ${date.date.toDateString()}.`);
  if (time) {
    explanation.push(`Time read as ${String(time.hours).padStart(2, "0")}:${String(time.minutes).padStart(2, "0")}.`);
  }
  if (duration) explanation.push(`Duration read as ${duration.minutes} minutes.`);

  const base = date ? new Date(date.date) : atMidnight(now);
  if (time) base.setHours(time.hours, time.minutes, 0, 0);

  // A specific clock time means an appointment; a date alone means a deadline.
  if (time) {
    const minutes = duration?.minutes ?? 60;
    return {
      type: "event",
      confidence: date ? 0.85 : 0.7,
      title: title || "Untitled event",
      startsAt: base,
      endsAt: new Date(base.getTime() + minutes * 60_000),
      estimatedMinutes: minutes,
      priority,
      alternatives: ["task"],
      explanation: [...explanation, "A specific time reads as a calendar event."],
    };
  }

  if (date) {
    return {
      type: "task",
      confidence: 0.88,
      title: title || "Untitled task",
      dueDate: (() => {
        const due = new Date(date.date);
        due.setHours(17, 0, 0, 0);
        return due;
      })(),
      estimatedMinutes: duration?.minutes,
      priority,
      alternatives: ["event", "note"],
      explanation: [...explanation, "A date with no time reads as a deadline."],
    };
  }

  // Nothing structural to go on. Verb-leading text is usually an action.
  const startsWithVerb =
    /^(call|email|text|buy|book|send|write|draft|finish|review|read|fix|plan|schedule|pay|order|check|ask|clean|renew|cancel|update|prepare|research)\b/i.test(
      title,
    );

  return {
    type: startsWithVerb ? "task" : "note",
    confidence: startsWithVerb ? 0.72 : 0.5,
    title: title.slice(0, 160) || "Untitled",
    body: startsWithVerb ? undefined : title,
    estimatedMinutes: duration?.minutes,
    priority,
    alternatives: startsWithVerb ? ["note", "event"] : ["task", "idea"],
    explanation: [
      ...explanation,
      startsWithVerb
        ? "Starts with an action word, so it reads as a task."
        : "No date, time or action word, so this is ambiguous.",
    ],
  };
}

import { describe, expect, it } from "vitest";
import {
  computeGoalProgress, computeThresholdState, computeTimeElapsed,
} from "@/lib/domain/goals";
import { computeProgress } from "@/lib/domain/projects";
import { computeStreak, expectedCompletions } from "@/lib/domain/habits";
import { daysUntilAnniversary } from "@/lib/domain/relationships";
import { analyseEvents, findFreeSlots } from "@/lib/domain/calendar";
import { inQuietHours } from "@/lib/notifications/engine";
import { changePct, formatDuration, isoDate, startOfWeek } from "@/lib/utils";
import type { CalendarEvent } from "@/db/schema";

describe("goal progress", () => {
  const base = { startValue: null, currentValue: null, targetValue: null, manualProgress: null };

  it("measures from the start value, not from zero", () => {
    // $108k to $250k, currently $179.4k, is half way — not 72%.
    const progress = computeGoalProgress({
      ...base,
      startValue: 108_000,
      currentValue: 179_400,
      targetValue: 250_000,
    });
    expect(progress).toBeCloseTo(0.503, 2);
  });

  it("handles goals that count downward", () => {
    const progress = computeGoalProgress({
      ...base,
      startValue: 100,
      currentValue: 75,
      targetValue: 50,
    });
    expect(progress).toBeCloseTo(0.5, 5);
  });

  it("clamps beyond the target rather than exceeding 100%", () => {
    expect(
      computeGoalProgress({ ...base, startValue: 0, currentValue: 150, targetValue: 100 }),
    ).toBe(1);
  });

  it("returns null when there is nothing measurable, instead of guessing zero", () => {
    expect(computeGoalProgress(base)).toBeNull();
  });

  it("falls back to manual progress when no metric exists", () => {
    expect(computeGoalProgress({ ...base, manualProgress: 0.4 })).toBe(0.4);
  });

  it("reports time elapsed against the target date", () => {
    const createdAt = new Date(Date.now() - 50 * 86_400_000);
    const targetDate = new Date(Date.now() + 50 * 86_400_000);
    expect(computeTimeElapsed({ createdAt, targetDate })).toBeCloseTo(0.5, 1);
  });

  it("returns null time elapsed with no target date", () => {
    expect(computeTimeElapsed({ createdAt: new Date(), targetDate: null })).toBeNull();
  });
});

describe("threshold goals", () => {
  const base = { startValue: null, manualProgress: null };

  it("has no percentage, because holding a line is not a climb", () => {
    // A 4.0 against a 3.75 floor must not read as "100% done" in September.
    expect(
      computeGoalProgress({ ...base, kind: "floor", currentValue: 4.0, targetValue: 3.75 }),
    ).toBeNull();
  });

  it("reports a floor as met while the reading is at or above the line", () => {
    const state = computeThresholdState({ kind: "floor", currentValue: 4.0, targetValue: 3.75 });
    expect(state).toMatchObject({ meeting: true, side: "above" });
    expect(state?.margin).toBeCloseTo(0.25, 5);
  });

  it("treats exactly on the line as met, not breached", () => {
    expect(
      computeThresholdState({ kind: "floor", currentValue: 3.75, targetValue: 3.75 })?.meeting,
    ).toBe(true);
  });

  it("reports a floor as breached once the reading drops under it", () => {
    const state = computeThresholdState({ kind: "floor", currentValue: 3.6, targetValue: 3.75 });
    expect(state?.meeting).toBe(false);
    expect(state?.margin).toBeCloseTo(0.15, 5);
  });

  it("inverts the test for a ceiling", () => {
    expect(
      computeThresholdState({ kind: "ceiling", currentValue: 55, targetValue: 60 })?.meeting,
    ).toBe(true);
    expect(
      computeThresholdState({ kind: "ceiling", currentValue: 65, targetValue: 60 })?.meeting,
    ).toBe(false);
  });

  it("says nothing at all without a reading", () => {
    expect(
      computeThresholdState({ kind: "floor", currentValue: null, targetValue: 3.75 }),
    ).toBeNull();
  });

  it("does not apply to ordinary target goals", () => {
    expect(
      computeThresholdState({ kind: "target", currentValue: 10, targetValue: 20 }),
    ).toBeNull();
  });

  it("leaves ordinary target goals computing a percentage as before", () => {
    expect(
      computeGoalProgress({ ...base, kind: "target", currentValue: 16, targetValue: 12, startValue: 16 }),
    ).toBe(0);
  });
});

describe("project progress", () => {
  it("is the share of tasks completed", () => {
    expect(computeProgress(3, 4)).toBe(75);
  });

  it("reports 0 for a project with no tasks, not 100", () => {
    // "Nothing planned yet" must not read as "finished".
    expect(computeProgress(0, 0)).toBe(0);
  });

  it("reports 100 only when every task is done", () => {
    expect(computeProgress(5, 5)).toBe(100);
  });
});

describe("habit streaks", () => {
  const day = (offset: number) => isoDate(new Date(Date.now() + offset * 86_400_000));

  it("counts consecutive completed days", () => {
    const done = new Set([day(0), day(-1), day(-2)]);
    expect(computeStreak(done)).toBe(3);
  });

  it("does not break the streak just because today is not done yet", () => {
    const done = new Set([day(-1), day(-2), day(-3)]);
    expect(computeStreak(done)).toBe(3);
  });

  it("breaks on a missed day that has fully passed", () => {
    const done = new Set([day(-2), day(-3)]);
    expect(computeStreak(done)).toBe(0);
  });

  it("returns zero for a habit never completed", () => {
    expect(computeStreak(new Set())).toBe(0);
  });
});

describe("expected habit completions", () => {
  it("respects a target of several times a week", () => {
    // Five a week over 28 days is 20 sessions, not four.
    expect(expectedCompletions("weekly", 5, 28)).toBeCloseTo(20, 5);
  });

  it("treats a once-a-week habit as roughly four in a month", () => {
    expect(expectedCompletions("weekly", 1, 28)).toBeCloseTo(4, 5);
  });

  it("caps a daily habit at one a day however the target is set", () => {
    expect(expectedCompletions("daily", 1, 30)).toBe(30);
    expect(expectedCompletions("daily", 3, 30)).toBe(30);
  });

  it("scales to how long the habit has existed", () => {
    // A habit two days old is not behind on a month of sessions.
    expect(expectedCompletions("weekly", 5, 2)).toBeCloseTo(10 / 7, 5);
    expect(expectedCompletions("daily", 1, 0)).toBe(0);
  });
});

describe("anniversaries", () => {
  it("finds the next occurrence, ignoring the stored year", () => {
    const from = new Date(2026, 8, 9);
    const birthday = new Date(1990, 8, 20);
    expect(daysUntilAnniversary(birthday, from)).toBe(11);
  });

  it("rolls into next year once the date has passed", () => {
    const from = new Date(2026, 8, 9);
    const birthday = new Date(1990, 0, 5);
    expect(daysUntilAnniversary(birthday, from)).toBeGreaterThan(100);
  });

  it("returns null with no date recorded", () => {
    expect(daysUntilAnniversary(null)).toBeNull();
  });
});

/* ------------------------------------------------------------------ calendar */

function event(partial: Partial<CalendarEvent> & { startsAt: Date; endsAt: Date }): CalendarEvent {
  return {
    id: crypto.randomUUID(),
    userId: "u",
    calendarId: null,
    calendarName: null,
    title: "Event",
    description: null,
    location: null,
    allDay: false,
    category: "meeting",
    attendees: [],
    taskId: null,
    projectId: null,
    origin: "user",
    isDemo: false,
    provider: null,
    externalId: null,
    lastSyncedAt: null,
    sourceMeta: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...partial,
  } as CalendarEvent;
}

describe("calendar analytics", () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 9, h, m, 0, 0);

  it("splits meeting and focus time", () => {
    const result = analyseEvents(
      [
        event({ startsAt: at(9), endsAt: at(10), category: "meeting" }),
        event({ startsAt: at(14), endsAt: at(16), category: "focus" }),
      ],
      new Date(2026, 8, 9),
      1,
    );
    expect(result.meetingMinutes).toBe(60);
    expect(result.focusMinutes).toBe(120);
  });

  it("flags a day fragmented by short unusable gaps", () => {
    const result = analyseEvents(
      [
        event({ startsAt: at(9), endsAt: at(9, 30) }),
        event({ startsAt: at(10), endsAt: at(10, 30) }),
        event({ startsAt: at(11), endsAt: at(11, 30) }),
      ],
      new Date(2026, 8, 9),
      1,
    );
    // Two 30-minute gaps, both too short for real work.
    expect(result.fragmentedDays).toHaveLength(1);
    expect(result.fragmentedDays[0].gaps).toBe(2);
  });

  it("does not flag a day with one long clear stretch", () => {
    const result = analyseEvents(
      [
        event({ startsAt: at(9), endsAt: at(10) }),
        event({ startsAt: at(15), endsAt: at(16) }),
      ],
      new Date(2026, 8, 9),
      1,
    );
    expect(result.fragmentedDays).toHaveLength(0);
  });

  it("marks a meeting-heavy day as overloaded", () => {
    const result = analyseEvents(
      [
        event({ startsAt: at(9), endsAt: at(12) }),
        event({ startsAt: at(13), endsAt: at(15) }),
      ],
      new Date(2026, 8, 9),
      1,
    );
    expect(result.overloadedDays).toHaveLength(1);
  });
});

describe("free slots", () => {
  const day = new Date(2026, 8, 9);
  const at = (h: number, m = 0) => new Date(2026, 8, 9, h, m, 0, 0);

  it("finds the gaps between booked events inside working hours", () => {
    const slots = findFreeSlots(
      [
        event({ startsAt: at(9), endsAt: at(10) }),
        event({ startsAt: at(14), endsAt: at(15) }),
      ],
      day,
      { minMinutes: 30 },
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].minutes).toBe(240); // 10:00 to 14:00
    expect(slots[1].minutes).toBe(180); // 15:00 to 18:00
  });

  it("ignores gaps shorter than the minimum", () => {
    const slots = findFreeSlots(
      [
        event({ startsAt: at(9), endsAt: at(12) }),
        event({ startsAt: at(12, 15), endsAt: at(18) }),
      ],
      day,
      { minMinutes: 30 },
    );
    expect(slots).toHaveLength(0);
  });

  it("returns the whole window when nothing is booked", () => {
    const slots = findFreeSlots([], day, { minMinutes: 30 });
    expect(slots).toHaveLength(1);
    expect(slots[0].minutes).toBe(540);
  });

  it("handles overlapping events without producing negative gaps", () => {
    const slots = findFreeSlots(
      [
        event({ startsAt: at(9), endsAt: at(13) }),
        event({ startsAt: at(10), endsAt: at(11) }),
      ],
      day,
      { minMinutes: 30 },
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].minutes).toBe(300);
  });
});

describe("quiet hours", () => {
  // Instants are written in UTC and read in a named zone, so these assertions
  // mean the same thing on a laptop in Missouri and on a build server in UTC.
  const at = (utc: string) => new Date(utc);
  const CHICAGO = "America/Chicago";

  it("handles a window that wraps past midnight", () => {
    expect(inQuietHours(at("2026-09-10T04:30:00Z"), "22:00", "07:00", CHICAGO)).toBe(true);
    expect(inQuietHours(at("2026-09-10T07:00:00Z"), "22:00", "07:00", CHICAGO)).toBe(true);
    expect(inQuietHours(at("2026-09-09T17:00:00Z"), "22:00", "07:00", CHICAGO)).toBe(false);
  });

  it("handles a window inside a single day", () => {
    expect(inQuietHours(at("2026-09-09T19:00:00Z"), "13:00", "17:00", CHICAGO)).toBe(true);
    expect(inQuietHours(at("2026-09-09T23:00:00Z"), "13:00", "17:00", CHICAGO)).toBe(false);
  });

  it("excludes the exact end minute", () => {
    expect(inQuietHours(at("2026-09-09T12:00:00Z"), "22:00", "07:00", CHICAGO)).toBe(false);
  });

  it("reads the clock in the user's zone, not the server's", () => {
    // 22:30 UTC is 17:30 in Chicago — the evening, not the middle of the night.
    // Judging it on the server clock is what silenced a hosted deployment.
    const evening = at("2026-09-10T22:30:00Z");
    expect(inQuietHours(evening, "22:00", "07:00", "UTC")).toBe(true);
    expect(inQuietHours(evening, "22:00", "07:00", CHICAGO)).toBe(false);
  });

  it("falls back to the server clock rather than throwing on a bad zone", () => {
    expect(() => inQuietHours(new Date(), "22:00", "07:00", "Not/AZone")).not.toThrow();
  });
});

describe("date and number helpers", () => {
  it("starts the week on Monday by default", () => {
    // 2026-09-09 is a Wednesday.
    expect(isoDate(startOfWeek(new Date(2026, 8, 9), 1))).toBe("2026-09-07");
  });

  it("supports a Sunday week start", () => {
    expect(isoDate(startOfWeek(new Date(2026, 8, 9), 0))).toBe("2026-09-06");
  });

  it("formats durations consistently", () => {
    expect(formatDuration(95)).toBe("1h 35m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(null)).toBeNull();
  });

  it("returns null percentage change with no baseline", () => {
    expect(changePct(10, 0)).toBeNull();
    expect(changePct(150, 100)).toBe(50);
  });
});

import { describe, expect, it } from "vitest";
import { zonedDayKey, zonedMinutes, zonedTimeToInstant, zoneOffsetMs } from "@/lib/time-zone";

const CHICAGO = "America/Chicago";

describe("zoned time", () => {
  it("reports the offset in force at that instant", () => {
    // Central Daylight Time is UTC-5, Central Standard Time is UTC-6.
    expect(zoneOffsetMs(new Date("2026-09-12T18:00:00Z"), CHICAGO)).toBe(-5 * 3_600_000);
    expect(zoneOffsetMs(new Date("2026-12-12T18:00:00Z"), CHICAGO)).toBe(-6 * 3_600_000);
  });

  it("knows which calendar day an instant falls on locally", () => {
    // Late evening in Chicago is already tomorrow in UTC, which is exactly the
    // mistake that files an evening habit under the wrong day.
    expect(zonedDayKey(new Date("2026-09-13T02:00:00Z"), CHICAGO)).toBe("2026-09-12");
    expect(zonedDayKey(new Date("2026-09-13T02:00:00Z"), "UTC")).toBe("2026-09-13");
  });

  it("reads the clock in the named zone", () => {
    expect(zonedMinutes(new Date("2026-09-12T12:30:00Z"), CHICAGO)).toBe(7 * 60 + 30);
  });

  it("turns a wall-clock time into the instant it happens", () => {
    const instant = zonedTimeToInstant("2026-09-12", "07:30", CHICAGO);
    expect(instant!.toISOString()).toBe("2026-09-12T12:30:00.000Z");
  });

  it("round-trips through a daylight saving change", () => {
    // US clocks go back on 1 November 2026. A briefing at 07:30 must still be
    // 07:30 to the person reading it, not 06:30 or 08:30.
    for (const day of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
      const instant = zonedTimeToInstant(day, "07:30", CHICAGO)!;
      expect(zonedMinutes(instant, CHICAGO)).toBe(7 * 60 + 30);
      expect(zonedDayKey(instant, CHICAGO)).toBe(day);
    }
  });

  it("refuses a malformed time rather than guessing", () => {
    expect(zonedTimeToInstant("2026-09-12", "not-a-time", CHICAGO)).toBeNull();
  });
});

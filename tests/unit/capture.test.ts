import { describe, expect, it } from "vitest";
import { CONFIRM_THRESHOLD, parseCapture } from "@/lib/capture/parse";

/** Fixed reference point: Wednesday 9 September 2026, 10:00 local. */
const NOW = new Date(2026, 8, 9, 10, 0, 0);

describe("parseCapture", () => {
  it("reads an action word with a relative date as a task", () => {
    const result = parseCapture("Call John tomorrow", NOW);
    expect(result.type).toBe("task");
    expect(result.title).toBe("Call John");
    expect(result.dueDate?.getDate()).toBe(10);
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIRM_THRESHOLD);
  });

  it("reads a specific clock time as an event, not a task", () => {
    const result = parseCapture("Workout at 6", NOW);
    expect(result.type).toBe("event");
    // "at 6" in a personal calendar means the evening, not 6am.
    expect(result.startsAt?.getHours()).toBe(18);
    expect(result.title).toBe("Workout");
  });

  it("honours an explicit prefix over everything else", () => {
    const result = parseCapture("Journal: today was productive", NOW);
    expect(result.type).toBe("journal");
    expect(result.body).toBe("today was productive");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("treats an idea prefix as an idea", () => {
    expect(parseCapture("Idea: start a podcast", NOW).type).toBe("idea");
  });

  it('reads "remember" as something to keep, not something to do', () => {
    const result = parseCapture("Remember that I want to research Spain", NOW);
    expect(result.type).toBe("note");
    expect(result.title).toBe("I want to research Spain");
  });

  it("flags genuinely ambiguous input as low confidence with alternatives", () => {
    const result = parseCapture("spain", NOW);
    expect(result.confidence).toBeLessThan(CONFIRM_THRESHOLD);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it("extracts duration and priority markers", () => {
    const result = parseCapture("Draft the proposal tomorrow for 90 minutes !", NOW);
    expect(result.estimatedMinutes).toBe(90);
    expect(result.priority).toBe("must");
    expect(result.title).toBe("Draft the proposal");
  });

  it("resolves a weekday to the next occurrence, never today", () => {
    // NOW is a Wednesday; "on wednesday" must mean next week.
    const result = parseCapture("Review the numbers on wednesday", NOW);
    expect(result.dueDate?.getDate()).toBe(16);
  });

  it("returns an empty result for empty input rather than throwing", () => {
    const result = parseCapture("   ", NOW);
    expect(result.title).toBe("");
    expect(result.confidence).toBe(0);
  });
});

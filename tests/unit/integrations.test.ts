import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "@/lib/integrations/crypto";
import { accessTokenExpired, normaliseGoogleEvent } from "@/lib/integrations/providers/google-calendar";

const SECRET = "a-test-secret-that-is-long-enough-to-be-realistic";

describe("credential encryption", () => {
  it("round-trips a token", () => {
    const value = { accessToken: "ya29.a0Af", refreshToken: "1//0gk", expiresAt: "1757000000000" };
    expect(decryptJson(encryptJson(value, SECRET), SECRET)).toEqual(value);
  });

  it("produces different ciphertext each time for the same input", () => {
    // A fixed IV would let anyone reading the database see when two
    // integrations hold the same token.
    const value = { accessToken: "same" };
    expect(encryptJson(value, SECRET)).not.toBe(encryptJson(value, SECRET));
  });

  it("refuses a token that was tampered with rather than returning nonsense", () => {
    const payload = encryptJson({ accessToken: "original" }, SECRET);
    const [iv, tag, data] = payload.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    const tampered = [iv, tag, flipped.toString("base64")].join(":");

    expect(() => decryptJson(tampered, SECRET)).toThrow();
  });

  it("refuses to decrypt with a different secret", () => {
    const payload = encryptJson({ accessToken: "original" }, SECRET);
    expect(() => decryptJson(payload, "a-completely-different-secret-value")).toThrow();
  });

  it("rejects a malformed payload with a clear message", () => {
    expect(() => decryptJson("not-a-real-payload", SECRET)).toThrow(/malformed/i);
  });
});

describe("normalising a Google event", () => {
  const at = (utc: string) => new Date(utc).toISOString();

  it("keeps a timed event's start and end", () => {
    const record = normaliseGoogleEvent(
      {
        id: "evt-1",
        summary: "Study hall",
        start: { dateTime: at("2026-09-13T23:00:00Z") },
        end: { dateTime: at("2026-09-14T01:00:00Z") },
      },
      "primary",
      "Jack",
    );

    expect(record).not.toBeNull();
    expect(record).toMatchObject({ kind: "event", externalId: "evt-1", title: "Study hall", allDay: false });
  });

  it("pulls an all-day event's end back inside the day it belongs to", () => {
    // Google's all-day end date is exclusive: a single day on the 14th is sent
    // as start 14th, end 15th. Stored literally it spans two days everywhere.
    const record = normaliseGoogleEvent(
      { id: "evt-2", summary: "Founders Day", start: { date: "2026-09-14" }, end: { date: "2026-09-15" } },
      "primary",
      "Jack",
    );

    expect(record?.kind).toBe("event");
    if (record?.kind !== "event") throw new Error("expected an event");
    expect(record.allDay).toBe(true);
    expect(record.endsAt.getTime()).toBeLessThan(new Date("2026-09-15T00:00:00").getTime());
    expect(record.endsAt.getTime()).toBeGreaterThan(record.startsAt.getTime());
  });

  it("skips an event with no usable times instead of inventing them", () => {
    expect(normaliseGoogleEvent({ id: "evt-3", summary: "Broken" }, "primary", "Jack")).toBeNull();
  });

  it("leaves the user out of the attendee list", () => {
    const record = normaliseGoogleEvent(
      {
        id: "evt-4",
        summary: "Coffee",
        start: { dateTime: at("2026-09-14T15:00:00Z") },
        end: { dateTime: at("2026-09-14T16:00:00Z") },
        attendees: [
          { displayName: "Jack", email: "jack@example.com", self: true },
          { displayName: "Priya", email: "priya@example.com" },
        ],
      },
      "primary",
      "Jack",
    );

    if (record?.kind !== "event") throw new Error("expected an event");
    expect(record.attendees).toEqual([{ name: "Priya", email: "priya@example.com" }]);
  });

  it("gives an untitled event a readable placeholder", () => {
    const record = normaliseGoogleEvent(
      {
        id: "evt-5",
        start: { dateTime: at("2026-09-14T15:00:00Z") },
        end: { dateTime: at("2026-09-14T16:00:00Z") },
      },
      "primary",
      "Jack",
    );

    if (record?.kind !== "event") throw new Error("expected an event");
    expect(record.title).toBe("(no title)");
  });
});

describe("access token expiry", () => {
  it("treats a missing expiry as expired rather than assuming it is fine", () => {
    expect(accessTokenExpired({})).toBe(true);
    expect(accessTokenExpired({ expiresAt: "not a number" })).toBe(true);
  });

  it("refreshes slightly before the deadline, not after it", () => {
    expect(accessTokenExpired({ expiresAt: String(Date.now() + 30_000) })).toBe(true);
    expect(accessTokenExpired({ expiresAt: String(Date.now() + 600_000) })).toBe(false);
  });
});

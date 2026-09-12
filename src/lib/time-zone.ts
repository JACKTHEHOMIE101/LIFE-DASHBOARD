/**
 * Converting between instants and wall-clock time in a named zone.
 *
 * Pure, with no database or `server-only` import, so it is directly testable
 * and usable from either side of the boundary.
 *
 * All of this exists because `Date`'s local methods report the *server's* zone,
 * which is the user's own clock on a laptop and UTC once hosted. Anything that
 * reasons about "07:30" or "today" has to name the zone explicitly or it will
 * be quietly wrong by the offset — silent, and wrong in the direction of doing
 * things at the wrong time of day.
 */

/** How far ahead of UTC the zone is at this instant, in milliseconds. */
export function zoneOffsetMs(instant: Date, timeZone: string) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(instant)
        .map((p) => [p.type, p.value]),
    );

    const asIfUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );

    return asIfUtc - instant.getTime();
  } catch {
    // An unrecognised zone must not take down whatever asked. UTC is the
    // honest fallback: wrong, but wrong in a way the caller can reason about.
    return 0;
  }
}

/** The calendar day in that zone, as YYYY-MM-DD. */
export function zonedDayKey(instant: Date, timeZone: string) {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  return shifted.toISOString().slice(0, 10);
}

/** Minutes past midnight on that zone's clock. */
export function zonedMinutes(instant: Date, timeZone: string) {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * The instant at which a given wall-clock time occurs in a zone.
 *
 * Applied twice because the offset depends on the answer: the offset used to
 * find the instant may differ from the offset actually in force at that
 * instant, which happens on the two days a year the clocks change. Iterating
 * settles it — and on a normal day the second pass changes nothing.
 */
export function zonedTimeToInstant(dayKey: string, hhmm: string, timeZone: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  if ([year, month, day, hour, minute].some((n) => !Number.isFinite(n))) return null;

  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  instant = new Date(naive - zoneOffsetMs(instant, timeZone));
  return instant;
}

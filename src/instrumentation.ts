/**
 * Runs once before the rest of the app, on every runtime Next.js starts.
 *
 * A hosted server runs in UTC. Every `new Date().getDate()` in the domain layer
 * — "due today", the habit day key, today's schedule — then answers in UTC, so
 * from 19:00 Central onwards the app quietly rolls over to tomorrow: an evening
 * habit is recorded against the wrong day and the dashboard shows a schedule
 * that has not happened yet.
 *
 * Vercel reserves `TZ`, but Node re-reads it whenever it changes, so setting it
 * here does the same job. This is sound because Life OS is single-user by
 * design: one person, one clock. If it ever serves two people in different
 * zones, this has to be replaced by passing the zone through the domain layer,
 * and `inQuietHours` is the pattern to follow.
 */
export function register() {
  const zone = process.env.APP_TIMEZONE?.trim();
  if (zone) process.env.TZ = zone;
}

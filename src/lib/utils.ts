import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------- dates */

const DAY = 86_400_000;

export function startOfDay(d: Date | number = new Date()) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(d: Date | number = new Date()) {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function addDays(d: Date | number, days: number) {
  return new Date(new Date(d).getTime() + days * DAY);
}

/** Monday-based week start, matching the default in user settings. */
export function startOfWeek(d: Date | number = new Date(), weekStartsOn = 1) {
  const date = startOfDay(d);
  const diff = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(date, -diff);
}

export function isoDate(d: Date | number) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function daysBetween(a: Date | number, b: Date | number) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
}

export function isToday(d: Date | number) {
  return isoDate(d) === isoDate(new Date());
}

/** "in 3 days", "yesterday", "18 days ago" — always relative to local midnight. */
export function relativeDay(d: Date | number) {
  const diff = daysBetween(new Date(), d);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 0) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

export function formatDate(d: Date | number, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...opts }).format(
    new Date(d),
  );
}

export function formatTime(d: Date | number) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function formatLongDate(d: Date | number = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(d));
}

/* --------------------------------------------------------------- durations */

/** 95 -> "1h 35m". Used everywhere durations are shown, so they read the same. */
export function formatDuration(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return null;
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* --------------------------------------------------------------- currency */

export function formatMoney(minor: number, currency = "USD", compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(minor / 100);
}

/* ----------------------------------------------------------------- numbers */

export function pct(value: number, digits = 0) {
  return `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(digits)}%`;
}

export function clamp(n: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n));
}

export function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Percentage change from `previous` to `current`. Returns null when there is no
 * baseline, so callers can say "not enough data" instead of inventing a number.
 */
export function changePct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function titleCase(value: string) {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

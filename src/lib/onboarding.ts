import type { db as Db } from "@/db/connection";
import {
  lifeAreas,
  notificationPreferences,
  timeBudgets,
  userSettings,
  type NotificationCategory,
} from "@/db/schema";

type Database = typeof Db;

export const DEFAULT_LIFE_AREAS = [
  { name: "Career", slug: "career", color: "indigo", icon: "briefcase" },
  { name: "Money", slug: "money", color: "emerald", icon: "wallet" },
  { name: "Health", slug: "health", color: "rose", icon: "heart-pulse" },
  { name: "Relationships", slug: "relationships", color: "amber", icon: "users" },
  { name: "Family", slug: "family", color: "orange", icon: "home" },
  { name: "Personal Growth", slug: "personal-growth", color: "violet", icon: "sprout" },
  { name: "Experiences", slug: "experiences", color: "cyan", icon: "compass" },
  { name: "Home", slug: "home", color: "teal", icon: "house" },
  { name: "Other", slug: "other", color: "slate", icon: "circle" },
] as const;

/**
 * Notification defaults are deliberately quiet: only the categories a person
 * would miss something real by ignoring are on for push, everything else is
 * in-app only. Section 33 of the brief: notify for meaningful things.
 */
const NOTIFICATION_DEFAULTS: {
  category: NotificationCategory;
  inapp: boolean;
  push: boolean;
  leadMinutes: number[];
}[] = [
  { category: "tasks", inapp: true, push: true, leadMinutes: [1440, 180] },
  { category: "calendar", inapp: true, push: true, leadMinutes: [60, 15] },
  { category: "projects", inapp: true, push: false, leadMinutes: [] },
  { category: "goals", inapp: true, push: false, leadMinutes: [43200, 10080, 1440] },
  { category: "health", inapp: true, push: false, leadMinutes: [] },
  { category: "finance", inapp: true, push: false, leadMinutes: [] },
  { category: "relationships", inapp: true, push: false, leadMinutes: [] },
  { category: "ai", inapp: true, push: false, leadMinutes: [] },
  { category: "system", inapp: true, push: false, leadMinutes: [] },
];

/** Rough starting split so intended-vs-actual has something to compare against. */
const DEFAULT_TIME_BUDGETS = [
  { category: "deep_work", intendedMinutesPerWeek: 900 },
  { category: "meetings", intendedMinutesPerWeek: 480 },
  { category: "health", intendedMinutesPerWeek: 300 },
  { category: "relationships", intendedMinutesPerWeek: 420 },
  { category: "personal_growth", intendedMinutesPerWeek: 180 },
];

/** Everything a brand new account needs before the dashboard makes sense. */
export async function provisionUserDefaults(database: Database, userId: string) {
  await database.insert(userSettings).values({ userId }).onConflictDoNothing();

  await database
    .insert(lifeAreas)
    .values(
      DEFAULT_LIFE_AREAS.map((area, index) => ({
        userId,
        name: area.name,
        slug: area.slug,
        color: area.color,
        icon: area.icon,
        sortOrder: index,
      })),
    )
    .onConflictDoNothing();

  await database
    .insert(notificationPreferences)
    .values(
      NOTIFICATION_DEFAULTS.flatMap((pref) => [
        {
          userId,
          category: pref.category,
          channel: "inapp" as const,
          enabled: pref.inapp,
          leadMinutes: pref.leadMinutes,
        },
        {
          userId,
          category: pref.category,
          channel: "push" as const,
          enabled: pref.push,
          priorityThreshold: "normal" as const,
          leadMinutes: pref.leadMinutes,
        },
      ]),
    )
    .onConflictDoNothing();

  await database
    .insert(timeBudgets)
    .values(DEFAULT_TIME_BUDGETS.map((b) => ({ userId, ...b })))
    .onConflictDoNothing();
}

import "server-only";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { interactions, people, type Person } from "@/db/schema";
import { daysBetween, startOfDay } from "@/lib/utils";

export type PersonSummary = Person & {
  daysSinceContact: number | null;
  /** Only true when the user set a cadence and it has been exceeded. */
  isOverdue: boolean;
  daysUntilBirthday: number | null;
  recentInteractionCount: number;
};

/**
 * Days until the next occurrence of a birthday, ignoring the stored year.
 */
export function daysUntilAnniversary(date: Date | null, from = new Date()): number | null {
  if (!date) return null;
  const today = startOfDay(from);
  const next = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (next < today) next.setFullYear(next.getFullYear() + 1);
  return daysBetween(today, next);
}

export async function listPeople(userId: string): Promise<PersonSummary[]> {
  const rows = await db
    .select()
    .from(people)
    .where(and(eq(people.userId, userId), isNull(people.deletedAt)))
    .orderBy(asc(people.importance), asc(people.name));

  const now = new Date();
  return rows.map((person) => {
    const daysSinceContact = person.lastInteractionAt
      ? daysBetween(person.lastInteractionAt, now)
      : null;

    return {
      ...person,
      daysSinceContact,
      // Time passing is not itself a reason to get in touch. This only fires
      // when the user has said how often they want to, and it has been longer.
      isOverdue:
        person.cadenceDays !== null &&
        daysSinceContact !== null &&
        daysSinceContact > person.cadenceDays,
      daysUntilBirthday: daysUntilAnniversary(person.birthday, now),
      recentInteractionCount: 0,
    };
  });
}

/** People the user said they wanted to keep up with, where it has been longer. */
export async function getRelationshipsNeedingAttention(userId: string, limit = 5) {
  const all = await listPeople(userId);
  return all
    .filter((p) => p.isOverdue)
    .sort(
      (a, b) =>
        a.importance - b.importance ||
        (b.daysSinceContact ?? 0) - (a.daysSinceContact ?? 0),
    )
    .slice(0, limit);
}

export async function getUpcomingDates(userId: string, withinDays = 30) {
  const all = await listPeople(userId);
  return all
    .filter((p) => p.daysUntilBirthday !== null && p.daysUntilBirthday <= withinDays)
    .sort((a, b) => (a.daysUntilBirthday ?? 0) - (b.daysUntilBirthday ?? 0));
}

export async function getPersonWithHistory(userId: string, personId: string) {
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, personId), eq(people.userId, userId), isNull(people.deletedAt)))
    .limit(1);
  if (!person) return null;

  const history = await db
    .select()
    .from(interactions)
    .where(and(eq(interactions.personId, personId), isNull(interactions.deletedAt)))
    .orderBy(desc(interactions.occurredAt))
    .limit(50);

  return { ...person, history };
}

import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  events, goals, journalEntries, lifeAreas, notes, people, projects, tasks, transactions,
} from "@/db/schema";
import type { SearchHit } from "./search-types";

export type { SearchHit, SearchHitType, PaletteArea, PaletteProject } from "./search-types";
export { searchTypeLabel } from "./search-types";

/**
 * Global search across every entity type.
 *
 * This is a LIKE scan, which is the right tool at personal-database scale and
 * keeps the surface small. The shape of the return value is what matters: when
 * embeddings arrive, `globalSearch` can rank by vector distance and everything
 * calling it stays unchanged.
 */
export async function globalSearch(userId: string, query: string, perType = 5): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const like = `%${q}%`;

  const [taskHits, projectHits, goalHits, peopleHits, noteHits, journalHits, eventHits, txHits] =
    await Promise.all([
      db
        .select({ id: tasks.id, title: tasks.title, status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), sql`lower(${tasks.title}) like ${like}`))
        .limit(perType),
      db
        .select({ id: projects.id, title: projects.title, status: projects.status })
        .from(projects)
        .where(and(eq(projects.userId, userId), isNull(projects.deletedAt), sql`lower(${projects.title}) like ${like}`))
        .limit(perType),
      db
        .select({ id: goals.id, title: goals.title, status: goals.status })
        .from(goals)
        .where(and(eq(goals.userId, userId), isNull(goals.deletedAt), sql`lower(${goals.title}) like ${like}`))
        .limit(perType),
      db
        .select({ id: people.id, name: people.name, rel: people.relationshipType })
        .from(people)
        .where(and(eq(people.userId, userId), isNull(people.deletedAt), sql`lower(${people.name}) like ${like}`))
        .limit(perType),
      db
        .select({ id: notes.id, title: notes.title, type: notes.type })
        .from(notes)
        .where(
          and(
            eq(notes.userId, userId),
            isNull(notes.deletedAt),
            sql`(lower(${notes.title}) like ${like} or lower(${notes.body}) like ${like})`,
          ),
        )
        .limit(perType),
      db
        .select({ id: journalEntries.id, date: journalEntries.date })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.userId, userId),
            isNull(journalEntries.deletedAt),
            sql`(lower(coalesce(${journalEntries.notes},'')) like ${like}
                 or lower(coalesce(${journalEntries.wins},'')) like ${like}
                 or lower(coalesce(${journalEntries.challenges},'')) like ${like}
                 or lower(coalesce(${journalEntries.gratitude},'')) like ${like})`,
          ),
        )
        .limit(perType),
      db
        .select({ id: events.id, title: events.title, startsAt: events.startsAt })
        .from(events)
        .where(and(eq(events.userId, userId), isNull(events.deletedAt), sql`lower(${events.title}) like ${like}`))
        .orderBy(desc(events.startsAt))
        .limit(perType),
      db
        .select({ id: transactions.id, description: transactions.description, date: transactions.date })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            isNull(transactions.deletedAt),
            sql`lower(${transactions.description}) like ${like}`,
          ),
        )
        .orderBy(desc(transactions.date))
        .limit(perType),
    ]);

  return [
    ...taskHits.map((t): SearchHit => ({ id: t.id, type: "task", title: t.title, subtitle: t.status, href: `/tasks?task=${t.id}` })),
    ...projectHits.map((p): SearchHit => ({ id: p.id, type: "project", title: p.title, subtitle: p.status, href: `/projects/${p.id}` })),
    ...goalHits.map((g): SearchHit => ({ id: g.id, type: "goal", title: g.title, subtitle: g.status, href: `/goals?goal=${g.id}` })),
    ...peopleHits.map((p): SearchHit => ({ id: p.id, type: "person", title: p.name, subtitle: p.rel, href: `/relationships?person=${p.id}` })),
    ...noteHits.map((n): SearchHit => ({ id: n.id, type: "note", title: n.title, subtitle: n.type, href: `/notes?note=${n.id}` })),
    ...journalHits.map((j): SearchHit => ({ id: j.id, type: "journal", title: j.date, subtitle: "Journal entry", href: `/journal?date=${j.date}` })),
    ...eventHits.map((e): SearchHit => ({ id: e.id, type: "event", title: e.title, subtitle: e.startsAt.toDateString(), href: `/calendar?date=${e.startsAt.toISOString().slice(0, 10)}` })),
    ...txHits.map((t): SearchHit => ({ id: t.id, type: "transaction", title: t.description, subtitle: t.date, href: `/finances?tx=${t.id}` })),
  ];
}

/** Lightweight lists the palette and capture sheet need to build their forms. */
export async function getPaletteData(userId: string) {
  const [projectRows, areaRows] = await Promise.all([
    db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(and(eq(projects.userId, userId), isNull(projects.deletedAt), sql`${projects.status} in ('active','planning')`))
      .orderBy(projects.title),
    db
      .select({ id: lifeAreas.id, name: lifeAreas.name, color: lifeAreas.color })
      .from(lifeAreas)
      .where(and(eq(lifeAreas.userId, userId), isNull(lifeAreas.archivedAt), isNull(lifeAreas.deletedAt)))
      .orderBy(lifeAreas.sortOrder),
  ]);
  return { projects: projectRows, lifeAreas: areaRows };
}


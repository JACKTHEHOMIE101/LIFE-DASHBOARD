import type { Metadata } from "next";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { JournalView } from "@/components/journal/journal-view";
import { PageHeader } from "@/components/ui/primitives";
import { isoDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Journal" };

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const dateParam = Array.isArray(params.date) ? params.date[0] : params.date;
  const date = dateParam ?? isoDate(new Date());
  const query = (Array.isArray(params.q) ? params.q[0] : params.q) ?? "";

  const conditions = [eq(journalEntries.userId, user.id), isNull(journalEntries.deletedAt)];
  if (query.trim().length >= 2) {
    const like = `%${query.trim().toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${journalEntries.notes},'')) like ${like}
           or lower(coalesce(${journalEntries.wins},'')) like ${like}
           or lower(coalesce(${journalEntries.challenges},'')) like ${like}
           or lower(coalesce(${journalEntries.gratitude},'')) like ${like}
           or lower(coalesce(${journalEntries.tomorrowPriority},'')) like ${like})`,
    );
  }

  const [entries, todays] = await Promise.all([
    db
      .select()
      .from(journalEntries)
      .where(and(...conditions))
      .orderBy(desc(journalEntries.date))
      .limit(60),
    db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.userId, user.id), eq(journalEntries.date, date)))
      .limit(1),
  ]);

  return (
    <div className="animate-in">
      <PageHeader
        title="Journal"
        description="A short daily entry is what makes a weekly review possible."
      />
      <JournalView date={date} entry={todays[0] ?? null} entries={entries} query={query} />
    </div>
  );
}

import type { Metadata } from "next";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getPaletteData } from "@/lib/domain/search";
import { NotesView } from "@/components/notes/notes-view";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const query = one("q") ?? "";
  const type = one("type") ?? "";

  const conditions = [eq(notes.userId, user.id), isNull(notes.deletedAt)];
  if (query.trim().length >= 2) {
    const like = `%${query.trim().toLowerCase()}%`;
    conditions.push(sql`(lower(${notes.title}) like ${like} or lower(${notes.body}) like ${like})`);
  }
  if (type) conditions.push(sql`${notes.type} = ${type}`);

  const [rows, palette] = await Promise.all([
    db
      .select()
      .from(notes)
      .where(and(...conditions))
      .orderBy(desc(notes.updatedAt))
      .limit(200),
    getPaletteData(user.id),
  ]);

  const selectedId = one("note");
  const selected = rows.find((n) => n.id === selectedId) ?? rows[0] ?? null;

  return (
    <div className="animate-in">
      <PageHeader
        title="Notes"
        description="Everything you want to keep. Searchable now, and structured so semantic search can be layered on later."
      />
      <NotesView
        notes={rows}
        selected={selected}
        query={query}
        type={type}
        projects={palette.projects}
        lifeAreas={palette.lifeAreas}
        openNew={one("new") === "1"}
      />
    </div>
  );
}

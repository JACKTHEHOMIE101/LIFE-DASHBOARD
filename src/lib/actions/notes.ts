"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export type NoteState = { ok?: boolean; error?: string; id?: string };

const optional = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

const schema = z.object({
  title: z.string().trim().min(1, "Give the note a title.").max(200),
  body: z.string().max(50_000),
  type: z.enum(["note", "idea", "meeting", "bookmark", "document"]),
  url: z.string().trim().max(500).nullable(),
  tags: z.array(z.string()),
  lifeAreaId: z.string().nullable(),
  projectId: z.string().nullable(),
});

export async function saveNote(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const user = await requireUser();
  const id = optional(formData.get("id"));

  const parsed = schema.safeParse({
    title: formData.get("title"),
    body: String(formData.get("body") ?? ""),
    type: formData.get("type") ?? "note",
    url: optional(formData.get("url")),
    tags: String(formData.get("tags") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    lifeAreaId: optional(formData.get("lifeAreaId")),
    projectId: optional(formData.get("projectId")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  if (id) {
    await db
      .update(notes)
      .set(parsed.data)
      .where(and(eq(notes.id, id), eq(notes.userId, user.id)));
    revalidatePath("/notes");
    return { ok: true, id };
  }

  const [created] = await db
    .insert(notes)
    .values({ userId: user.id, ...parsed.data, origin: "user" })
    .returning();

  revalidatePath("/notes");
  return { ok: true, id: created.id };
}

export async function deleteNote(noteId: string) {
  const user = await requireUser();
  await db
    .update(notes)
    .set({ deletedAt: new Date() })
    .where(and(eq(notes.id, noteId), eq(notes.userId, user.id)));
  revalidatePath("/notes");
}

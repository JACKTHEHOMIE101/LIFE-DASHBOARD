"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isoDate } from "@/lib/utils";

export type JournalState = { ok?: boolean; error?: string };

const scale = z
  .string()
  .optional()
  .transform((v) => (v && v !== "" ? Number(v) : null))
  .refine((v) => v === null || (v >= 1 && v <= 5), "Ratings run from 1 to 5.");

const text = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim().slice(0, 4000) : null));

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date."),
  mood: scale,
  energy: scale,
  productivity: scale,
  wins: text,
  challenges: text,
  gratitude: text,
  notes: text,
  tomorrowPriority: text,
});

/** One entry per day: saving again updates that day rather than adding another. */
export async function saveJournalEntry(
  _prev: JournalState,
  formData: FormData,
): Promise<JournalState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    date: String(formData.get("date") ?? isoDate(new Date())),
    mood: formData.get("mood") ?? undefined,
    energy: formData.get("energy") ?? undefined,
    productivity: formData.get("productivity") ?? undefined,
    wins: formData.get("wins") ?? undefined,
    challenges: formData.get("challenges") ?? undefined,
    gratitude: formData.get("gratitude") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    tomorrowPriority: formData.get("tomorrowPriority") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const { date, ...fields } = parsed.data;

  const [existing] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, user.id), eq(journalEntries.date, date)))
    .limit(1);

  if (existing) {
    await db.update(journalEntries).set(fields).where(eq(journalEntries.id, existing.id));
  } else {
    await db.insert(journalEntries).values({ userId: user.id, date, ...fields, origin: "user" });
  }

  revalidatePath("/journal");
  return { ok: true };
}

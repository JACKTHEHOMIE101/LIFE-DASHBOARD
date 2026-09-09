"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { interactions, people, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export type PersonState = { ok?: boolean; error?: string };

const optional = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

const schema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(80),
  relationshipType: z.string().trim().max(40),
  importance: z.coerce.number().int().min(1).max(5),
  cadenceDays: z.coerce.number().int().min(1).max(730).nullable(),
  email: z.string().trim().max(120).nullable(),
  phone: z.string().trim().max(40).nullable(),
  birthday: z.string().nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export async function savePerson(_prev: PersonState, formData: FormData): Promise<PersonState> {
  const user = await requireUser();
  const id = optional(formData.get("id"));
  const cadenceRaw = optional(formData.get("cadenceDays"));

  const parsed = schema.safeParse({
    name: formData.get("name"),
    relationshipType: formData.get("relationshipType") ?? "friend",
    importance: formData.get("importance") ?? 3,
    cadenceDays: cadenceRaw,
    email: optional(formData.get("email")),
    phone: optional(formData.get("phone")),
    birthday: optional(formData.get("birthday")),
    notes: optional(formData.get("notes")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const values = {
    ...parsed.data,
    birthday: parsed.data.birthday ? new Date(parsed.data.birthday) : null,
  };

  if (id) {
    await db
      .update(people)
      .set(values)
      .where(and(eq(people.id, id), eq(people.userId, user.id)));
  } else {
    await db.insert(people).values({ userId: user.id, ...values, origin: "user" });
  }

  revalidatePath("/relationships");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Logs an interaction and moves the person's last-contact date forward, which
 * is what clears them from the attention list.
 */
export async function logInteraction(personId: string, type: string, notes?: string) {
  const user = await requireUser();
  const now = new Date();

  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.userId, user.id)))
    .limit(1);
  if (!person) return;

  await db.insert(interactions).values({
    userId: user.id,
    personId,
    type,
    occurredAt: now,
    notes: notes?.trim() || null,
    origin: "user",
  });

  await db.update(people).set({ lastInteractionAt: now }).where(eq(people.id, personId));

  revalidatePath("/relationships");
  revalidatePath("/");
}

export async function createReachOutTask(personId: string, name: string) {
  const user = await requireUser();
  await db.insert(tasks).values({
    userId: user.id,
    personId,
    title: `Reach out to ${name}`,
    priority: "should",
    energy: "low",
    estimatedMinutes: 15,
    dueDate: new Date(Date.now() + 2 * 86_400_000),
    origin: "user",
  });
  revalidatePath("/relationships");
  revalidatePath("/tasks");
}

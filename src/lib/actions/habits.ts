"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { habitEntries, habits } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isoDate } from "@/lib/utils";

export async function toggleHabitToday(habitId: string, done: boolean) {
  const user = await requireUser();
  const date = isoDate(new Date());

  // Ownership is checked here rather than trusted from the client.
  const [habit] = await db
    .select({ id: habits.id })
    .from(habits)
    .where(and(eq(habits.id, habitId), eq(habits.userId, user.id)))
    .limit(1);
  if (!habit) return;

  if (done) {
    await db
      .insert(habitEntries)
      .values({ userId: user.id, habitId, date, completed: true, origin: "user" })
      .onConflictDoUpdate({
        target: [habitEntries.habitId, habitEntries.date],
        set: { completed: true },
      });
  } else {
    await db
      .delete(habitEntries)
      .where(and(eq(habitEntries.habitId, habitId), eq(habitEntries.date, date)));
  }

  revalidatePath("/");
  revalidatePath("/habits");
}

const habitInput = z.object({
  name: z.string().trim().min(1, "Give the habit a name.").max(80),
  frequency: z.enum(["daily", "weekly"]).default("daily"),
  lifeAreaId: z.string().optional(),
  goalId: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function createHabit(_prev: { error?: string } | undefined, formData: FormData) {
  const user = await requireUser();
  const parsed = habitInput.safeParse({
    name: formData.get("name"),
    frequency: formData.get("frequency") ?? "daily",
    lifeAreaId: formData.get("lifeAreaId") ?? undefined,
    goalId: formData.get("goalId") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  await db.insert(habits).values({
    userId: user.id,
    name: parsed.data.name,
    frequency: parsed.data.frequency,
    lifeAreaId: parsed.data.lifeAreaId || null,
    goalId: parsed.data.goalId || null,
    notes: parsed.data.notes || null,
    origin: "user",
  });

  revalidatePath("/habits");
  revalidatePath("/");
  return { error: undefined };
}

export async function archiveHabit(habitId: string) {
  const user = await requireUser();
  await db
    .update(habits)
    .set({ active: false })
    .where(and(eq(habits.id, habitId), eq(habits.userId, user.id)));
  revalidatePath("/habits");
  revalidatePath("/");
}

"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { goals } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export type GoalState = { ok?: boolean; error?: string };

const optional = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const optionalNumber = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const schema = z.object({
  title: z.string().trim().min(1, "Give the goal a title.").max(200),
  why: z.string().trim().max(1000).nullable(),
  description: z.string().trim().max(4000).nullable(),
  status: z.enum(["active", "paused", "achieved", "abandoned"]),
  kind: z.enum(["target", "floor", "ceiling"]),
  targetDate: z.string().nullable(),
  lifeAreaId: z.string().nullable(),
  metricName: z.string().trim().max(80).nullable(),
  metricUnit: z.string().trim().max(20).nullable(),
  startValue: z.number().nullable(),
  currentValue: z.number().nullable(),
  targetValue: z.number().nullable(),
});

function parse(formData: FormData) {
  return schema.safeParse({
    title: formData.get("title"),
    why: optional(formData.get("why")),
    description: optional(formData.get("description")),
    status: formData.get("status") ?? "active",
    kind: formData.get("kind") ?? "target",
    targetDate: optional(formData.get("targetDate")),
    lifeAreaId: optional(formData.get("lifeAreaId")),
    metricName: optional(formData.get("metricName")),
    metricUnit: optional(formData.get("metricUnit")),
    startValue: optionalNumber(formData.get("startValue")),
    currentValue: optionalNumber(formData.get("currentValue")),
    targetValue: optionalNumber(formData.get("targetValue")),
  });
}

export async function createGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const user = await requireUser();
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  await db.insert(goals).values({
    userId: user.id,
    ...parsed.data,
    targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null,
    lastProgressAt: new Date(),
    origin: "user",
  });

  revalidatePath("/goals");
  revalidatePath("/");
  return { ok: true };
}

export async function updateGoal(_prev: GoalState, formData: FormData): Promise<GoalState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const [existing] = await db
    .select({ currentValue: goals.currentValue })
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.userId, user.id)))
    .limit(1);
  if (!existing) return { error: "That goal no longer exists." };

  // Only an actual change in the measured value counts as progress; editing the
  // title should not reset the neglected-goal clock.
  const movedForward =
    parsed.data.currentValue !== null && parsed.data.currentValue !== existing.currentValue;

  await db
    .update(goals)
    .set({
      ...parsed.data,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null,
      ...(movedForward ? { lastProgressAt: new Date() } : {}),
    })
    .where(and(eq(goals.id, id), eq(goals.userId, user.id)));

  revalidatePath("/goals");
  revalidatePath("/");
  return { ok: true };
}

/** Quick inline update of just the measured value. */
export async function recordGoalProgress(goalId: string, value: number) {
  const user = await requireUser();
  await db
    .update(goals)
    .set({ currentValue: value, lastProgressAt: new Date() })
    .where(and(eq(goals.id, goalId), eq(goals.userId, user.id)));
  revalidatePath("/goals");
  revalidatePath("/");
}

export async function deleteGoal(goalId: string) {
  const user = await requireUser();
  await db
    .update(goals)
    .set({ deletedAt: new Date() })
    .where(and(eq(goals.id, goalId), eq(goals.userId, user.id)));
  revalidatePath("/goals");
}

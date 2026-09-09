"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { recordActivity } from "./activity";

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "" ? v : null));

const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v && v !== "" ? new Date(`${v}T17:00:00`) : null));

const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v && v !== "" ? Number(v) : null))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Enter a positive number.");

const taskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["must", "should", "could"]).default("should"),
  energy: z.enum(["low", "medium", "high"]).default("medium"),
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).optional(),
  dueDate: optionalDate,
  estimatedMinutes: optionalNumber,
  projectId: optionalId,
  lifeAreaId: optionalId,
  tags: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
});

export type ActionState = { ok?: boolean; error?: string };

function parseForm(formData: FormData) {
  return taskInput.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    priority: formData.get("priority") ?? "should",
    energy: formData.get("energy") ?? "medium",
    status: formData.get("status") ?? undefined,
    dueDate: formData.get("dueDate") ?? undefined,
    estimatedMinutes: formData.get("estimatedMinutes") ?? undefined,
    projectId: formData.get("projectId") ?? undefined,
    lifeAreaId: formData.get("lifeAreaId") ?? undefined,
    tags: formData.get("tags") ?? undefined,
  });
}

function revalidateTaskViews() {
  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath("/projects");
  revalidatePath("/analytics");
}

export async function createTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const data = parsed.data;

  // A task inherits its life area from its project unless one was chosen, so
  // area rollups stay correct without asking the user twice.
  let lifeAreaId = data.lifeAreaId;
  if (!lifeAreaId && data.projectId) {
    const [project] = await db
      .select({ lifeAreaId: projects.lifeAreaId })
      .from(projects)
      .where(and(eq(projects.id, data.projectId), eq(projects.userId, user.id)))
      .limit(1);
    lifeAreaId = project?.lifeAreaId ?? null;
  }

  await db.insert(tasks).values({
    userId: user.id,
    title: data.title,
    description: data.description || null,
    priority: data.priority,
    energy: data.energy,
    dueDate: data.dueDate,
    estimatedMinutes: data.estimatedMinutes,
    projectId: data.projectId,
    lifeAreaId,
    tags: data.tags,
    origin: "user",
  });

  if (data.projectId) await recordActivity(user.id, data.projectId);
  revalidateTaskViews();
  return { ok: true };
}

export async function updateTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing task." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const data = parsed.data;

  const [updated] = await db
    .update(tasks)
    .set({
      title: data.title,
      description: data.description || null,
      priority: data.priority,
      energy: data.energy,
      dueDate: data.dueDate,
      estimatedMinutes: data.estimatedMinutes,
      projectId: data.projectId,
      lifeAreaId: data.lifeAreaId,
      tags: data.tags,
      ...(data.status ? { status: data.status } : {}),
    })
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id), isNull(tasks.deletedAt)))
    .returning();

  if (!updated) return { error: "That task no longer exists." };
  if (updated.projectId) await recordActivity(user.id, updated.projectId);
  revalidateTaskViews();
  return { ok: true };
}

/** Completing and un-completing share a path so the two can never disagree. */
export async function setTaskDone(taskId: string, done: boolean) {
  const user = await requireUser();
  const [updated] = await db
    .update(tasks)
    .set({
      status: done ? "done" : "todo",
      completedAt: done ? new Date() : null,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, user.id), isNull(tasks.deletedAt)))
    .returning();

  if (updated?.projectId) await recordActivity(user.id, updated.projectId);
  revalidateTaskViews();
}

export async function snoozeTask(taskId: string, days: number) {
  const user = await requireUser();
  const until = new Date(Date.now() + days * 86_400_000);
  await db
    .update(tasks)
    .set({ snoozedUntil: until, dueDate: until })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, user.id)));
  revalidateTaskViews();
}

/** Soft delete: the row stays for history and analytics, hidden from all reads. */
export async function deleteTask(taskId: string) {
  const user = await requireUser();
  await db
    .update(tasks)
    .set({ deletedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, user.id)));
  revalidateTaskViews();
}

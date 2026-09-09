"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { events, goals, journalEntries, notes, projects, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isoDate } from "@/lib/utils";
import { recordActivity } from "./activity";

const schema = z.object({
  type: z.enum(["task", "event", "note", "idea", "journal", "goal", "project"]),
  title: z.string().trim().min(1, "Nothing to capture.").max(200),
  body: z.string().trim().max(8000).optional(),
  dueDate: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  estimatedMinutes: z.coerce.number().int().positive().max(1440).optional(),
  priority: z.enum(["must", "should", "could"]).optional(),
  projectId: z.string().optional(),
  lifeAreaId: z.string().optional(),
});

export type CaptureResult = {
  ok?: boolean;
  error?: string;
  created?: { type: string; label: string; href: string };
};

const nullable = (value?: string) => (value && value !== "" ? value : null);
const asDate = (value?: string) => (value && value !== "" ? new Date(value) : null);

/**
 * Writes whatever the capture sheet decided on. The client has already parsed
 * and, where the reading was uncertain, had the user confirm the type — so this
 * only validates and persists.
 */
export async function commitCapture(input: unknown): Promise<CaptureResult> {
  const user = await requireUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That could not be saved." };
  }
  const data = parsed.data;
  const projectId = nullable(data.projectId);
  const lifeAreaId = nullable(data.lifeAreaId);

  switch (data.type) {
    case "task": {
      await db.insert(tasks).values({
        userId: user.id,
        title: data.title,
        description: data.body ?? null,
        dueDate: asDate(data.dueDate),
        estimatedMinutes: data.estimatedMinutes ?? null,
        priority: data.priority ?? "should",
        projectId,
        lifeAreaId,
        origin: "user",
      });
      if (projectId) await recordActivity(user.id, projectId);
      revalidatePath("/tasks");
      revalidatePath("/");
      return { ok: true, created: { type: "task", label: "Task added", href: "/tasks" } };
    }

    case "event": {
      const startsAt = asDate(data.startsAt) ?? new Date();
      const endsAt =
        asDate(data.endsAt) ?? new Date(startsAt.getTime() + (data.estimatedMinutes ?? 60) * 60_000);
      await db.insert(events).values({
        userId: user.id,
        title: data.title,
        startsAt,
        endsAt,
        category: "personal",
        calendarName: "Life OS",
        projectId,
        origin: "user",
      });
      revalidatePath("/calendar");
      revalidatePath("/");
      return { ok: true, created: { type: "event", label: "Event added", href: "/calendar" } };
    }

    case "note":
    case "idea": {
      await db.insert(notes).values({
        userId: user.id,
        title: data.title,
        body: data.body ?? data.title,
        type: data.type === "idea" ? "idea" : "note",
        projectId,
        lifeAreaId,
        origin: "user",
      });
      revalidatePath("/notes");
      return { ok: true, created: { type: data.type, label: "Note saved", href: "/notes" } };
    }

    case "journal": {
      const date = isoDate(new Date());
      // One entry per day: capturing twice appends rather than overwriting.
      const [existing] = await db
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.userId, user.id), eq(journalEntries.date, date)))
        .limit(1);

      if (existing) {
        await db
          .update(journalEntries)
          .set({ notes: [existing.notes, data.body ?? data.title].filter(Boolean).join("\n\n") })
          .where(eq(journalEntries.id, existing.id));
      } else {
        await db.insert(journalEntries).values({
          userId: user.id,
          date,
          notes: data.body ?? data.title,
          origin: "user",
        });
      }
      revalidatePath("/journal");
      return { ok: true, created: { type: "journal", label: "Added to today's journal", href: "/journal" } };
    }

    case "goal": {
      await db.insert(goals).values({
        userId: user.id,
        title: data.title,
        description: data.body ?? null,
        lifeAreaId,
        origin: "user",
        lastProgressAt: new Date(),
      });
      revalidatePath("/goals");
      return { ok: true, created: { type: "goal", label: "Goal created", href: "/goals" } };
    }

    case "project": {
      const [project] = await db
        .insert(projects)
        .values({
          userId: user.id,
          title: data.title,
          description: data.body ?? null,
          lifeAreaId,
          startedAt: new Date(),
          lastActivityAt: new Date(),
          origin: "user",
        })
        .returning();
      revalidatePath("/projects");
      return { ok: true, created: { type: "project", label: "Project created", href: `/projects/${project.id}` } };
    }
  }
}

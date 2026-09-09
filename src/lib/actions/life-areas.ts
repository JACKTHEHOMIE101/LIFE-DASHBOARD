"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { lifeAreas } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export type AreaState = { ok?: boolean; error?: string };

const schema = z.object({
  name: z.string().trim().min(1, "Give the area a name.").max(60),
  description: z.string().trim().max(300).nullable(),
  color: z.enum(["indigo", "emerald", "rose", "amber", "orange", "violet", "cyan", "teal", "slate"]),
});

/** Slugs are stable identities that the Life Pulse models key off. */
function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "area";
}

export async function createLifeArea(_prev: AreaState, formData: FormData): Promise<AreaState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    name: formData.get("name"),
    description: String(formData.get("description") ?? "").trim() || null,
    color: formData.get("color") ?? "slate",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${lifeAreas.sortOrder}), -1)` })
    .from(lifeAreas)
    .where(eq(lifeAreas.userId, user.id));

  let slug = slugify(parsed.data.name);
  const [clash] = await db
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(and(eq(lifeAreas.userId, user.id), eq(lifeAreas.slug, slug)))
    .limit(1);
  if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  await db.insert(lifeAreas).values({
    userId: user.id,
    name: parsed.data.name,
    description: parsed.data.description,
    color: parsed.data.color,
    slug,
    sortOrder: Number(max) + 1,
  });

  revalidatePath("/life-areas");
  revalidatePath("/");
  return { ok: true };
}

export async function renameLifeArea(areaId: string, name: string, color: string) {
  const user = await requireUser();
  if (!name.trim()) return;
  await db
    .update(lifeAreas)
    .set({ name: name.trim().slice(0, 60), color })
    .where(and(eq(lifeAreas.id, areaId), eq(lifeAreas.userId, user.id)));
  revalidatePath("/life-areas");
  revalidatePath("/");
}

export async function setAreaArchived(areaId: string, archived: boolean) {
  const user = await requireUser();
  await db
    .update(lifeAreas)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(lifeAreas.id, areaId), eq(lifeAreas.userId, user.id)));
  revalidatePath("/life-areas");
  revalidatePath("/");
}

/** Moves an area one place up or down in the sidebar ordering. */
export async function moveLifeArea(areaId: string, direction: "up" | "down") {
  const user = await requireUser();
  const areas = await db
    .select()
    .from(lifeAreas)
    .where(eq(lifeAreas.userId, user.id))
    .orderBy(lifeAreas.sortOrder);

  const index = areas.findIndex((a) => a.id === areaId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= areas.length) return;

  await db
    .update(lifeAreas)
    .set({ sortOrder: areas[swapWith].sortOrder })
    .where(eq(lifeAreas.id, areas[index].id));
  await db
    .update(lifeAreas)
    .set({ sortOrder: areas[index].sortOrder })
    .where(eq(lifeAreas.id, areas[swapWith].id));

  revalidatePath("/life-areas");
}

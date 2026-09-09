"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { reviews, type ReviewType } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { buildReviewStats, draftSections, reviewPeriod } from "@/lib/domain/reviews";
import { aiConfigured } from "@/lib/ai/chief-of-staff";
import { isoDate } from "@/lib/utils";

export type ReviewActionState = { ok?: boolean; error?: string; id?: string };

/**
 * Builds a review for the period just ended.
 *
 * Numbers come from the database; the model, if configured, only rewrites the
 * narrative around them. Regenerating never overwrites a review the user has
 * already edited.
 */
export async function generateReview(type: ReviewType): Promise<ReviewActionState> {
  const user = await requireUser();
  const { start } = reviewPeriod(type, user.settings.weekStartsOn, -1);
  const periodStart = isoDate(start);

  const [existing] = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.userId, user.id),
        eq(reviews.type, type),
        eq(reviews.periodStart, periodStart),
      ),
    )
    .limit(1);

  if (existing?.editedByUser) {
    return { ok: true, id: existing.id };
  }

  const stats = await buildReviewStats(user.id, type, user.settings.weekStartsOn, -1);
  let sections = draftSections(stats, type);

  if (aiConfigured()) {
    try {
      sections = await writeNarrative(stats, sections, type, user.name.split(" ")[0]);
    } catch {
      // A model failure must not block the review: the deterministic draft
      // already says everything factual.
    }
  }

  if (existing) {
    await db
      .update(reviews)
      .set({ stats, sections })
      .where(eq(reviews.id, existing.id));
    revalidatePath("/reviews");
    return { ok: true, id: existing.id };
  }

  const [created] = await db
    .insert(reviews)
    .values({
      userId: user.id,
      type,
      periodStart,
      periodEnd: stats.periodEnd,
      stats,
      sections,
      status: "draft",
      origin: aiConfigured() ? "ai" : "user",
    })
    .returning();

  revalidatePath("/reviews");
  revalidatePath("/");
  return { ok: true, id: created.id };
}

async function writeNarrative(
  stats: Awaited<ReturnType<typeof buildReviewStats>>,
  draft: Record<string, string>,
  type: ReviewType,
  name: string,
): Promise<Record<string, string>> {
  const client = new Anthropic();
  const response = await client.messages
    .stream({
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: `You write ${name}'s ${type} review inside their Life OS.

You are given computed facts and a plain draft. Rewrite the draft into calm, direct prose.

Rules that cannot be broken:
- Never invent, round differently, or change any number, name or date. Every figure must already appear in the facts.
- Do not add achievements, problems or events that are not in the facts.
- No motivational language, no praise inflation, no exclamation marks.
- Two to four sentences per section. Shorter is better.
- Where you draw a conclusion from the facts, mark it as a reading rather than a fact ("this suggests", "it looks like").
- Leave the reflection section as an empty string; that is for ${name} to write.

Return only a JSON object with exactly these keys: wins, problems, time, health, money, neglected, habits, nextPeriod, reflection.`,
      messages: [
        {
          role: "user",
          content: `FACTS:\n${JSON.stringify(stats, null, 2)}\n\nDRAFT:\n${JSON.stringify(draft, null, 2)}`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: Object.fromEntries(
              ["wins", "problems", "time", "health", "money", "neglected", "habits", "nextPeriod", "reflection"].map(
                (k) => [k, { type: "string" }],
              ),
            ),
            required: ["wins", "problems", "time", "health", "money", "neglected", "habits", "nextPeriod", "reflection"],
            additionalProperties: false,
          },
        },
      },
    })
    .finalMessage();

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return draft;

  const parsed = JSON.parse(text.text) as Record<string, string>;
  // Keep the deterministic draft for anything the model left blank.
  return Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [key, parsed[key]?.trim() || value]),
  );
}

export async function saveReviewSections(
  reviewId: string,
  sections: Record<string, string>,
): Promise<ReviewActionState> {
  const user = await requireUser();
  await db
    .update(reviews)
    .set({ sections, editedByUser: true })
    .where(and(eq(reviews.id, reviewId), eq(reviews.userId, user.id)));
  revalidatePath("/reviews");
  return { ok: true, id: reviewId };
}

export async function finaliseReview(reviewId: string) {
  const user = await requireUser();
  await db
    .update(reviews)
    .set({ status: "final" })
    .where(and(eq(reviews.id, reviewId), eq(reviews.userId, user.id)));
  revalidatePath("/reviews");
  revalidatePath("/");
}

export async function archiveReview(reviewId: string) {
  const user = await requireUser();
  await db
    .update(reviews)
    .set({ archivedAt: new Date() })
    .where(and(eq(reviews.id, reviewId), eq(reviews.userId, user.id)));
  revalidatePath("/reviews");
}

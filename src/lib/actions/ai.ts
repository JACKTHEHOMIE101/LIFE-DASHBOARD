"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiConversations, aiMessages, events, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { askChiefOfStaff, type Citation } from "@/lib/ai/chief-of-staff";
import type { ToolProposal } from "@/lib/ai/tools";
import { audit } from "./activity";

export type ChatResponse = {
  conversationId: string;
  text: string;
  citations: Citation[];
  proposals: ToolProposal[];
  offline: boolean;
  error?: string;
};

export async function sendChiefOfStaffMessage(
  conversationId: string | null,
  question: string,
): Promise<ChatResponse> {
  const user = await requireUser();
  const trimmed = question.trim();

  if (!trimmed) {
    return { conversationId: conversationId ?? "", text: "", citations: [], proposals: [], offline: false, error: "Ask a question first." };
  }

  // Conversations are per-user; an id from elsewhere resolves to nothing.
  let id = conversationId;
  if (id) {
    const [existing] = await db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, user.id)))
      .limit(1);
    if (!existing) id = null;
  }

  if (!id) {
    const [created] = await db
      .insert(aiConversations)
      .values({ userId: user.id, title: trimmed.slice(0, 60) })
      .returning();
    id = created.id;
  }

  const history = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, id))
    .orderBy(asc(aiMessages.createdAt))
    .limit(20);

  await db.insert(aiMessages).values({
    userId: user.id,
    conversationId: id,
    role: "user",
    content: trimmed,
  });

  try {
    const reply = await askChiefOfStaff({
      userId: user.id,
      userName: user.name.split(" ")[0],
      weekStartsOn: user.settings.weekStartsOn,
      history,
      question: trimmed,
    });

    await db.insert(aiMessages).values({
      userId: user.id,
      conversationId: id,
      role: "assistant",
      content: reply.text,
      citations: reply.citations,
      toolCalls: reply.toolCalls,
    });

    await db
      .update(aiConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiConversations.id, id));

    return {
      conversationId: id,
      text: reply.text,
      citations: reply.citations,
      proposals: reply.proposals,
      offline: reply.offline,
    };
  } catch (error) {
    const message =
      error instanceof Error && /api key|authentication/i.test(error.message)
        ? "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in your .env."
        : error instanceof Error && /rate limit/i.test(error.message)
          ? "Rate limited by the API. Try again shortly."
          : "The assistant is unavailable right now. Your data is untouched.";

    return {
      conversationId: id,
      text: "",
      citations: [],
      proposals: [],
      offline: false,
      error: message,
    };
  }
}

/**
 * Executes a proposal the user explicitly confirmed.
 *
 * The model never reaches this path on its own: the proposal travels to the
 * browser as a card, and only a click brings it back. Every write is recorded
 * in the audit log with the AI as the actor.
 */
export async function confirmProposal(proposal: ToolProposal): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();

  switch (proposal.kind) {
    case "create_task": {
      const p = proposal.payload as {
        title: string;
        dueDate: string | null;
        estimatedMinutes: number | null;
        priority: "must" | "should" | "could";
      };
      if (!p.title?.trim()) return { ok: false, message: "That proposal was incomplete." };

      const [task] = await db
        .insert(tasks)
        .values({
          userId: user.id,
          title: p.title.trim(),
          dueDate: p.dueDate ? new Date(`${p.dueDate}T17:00:00`) : null,
          estimatedMinutes: p.estimatedMinutes ?? null,
          priority: p.priority ?? "should",
          // Marked as AI-created so it is always distinguishable from what the
          // user wrote themselves.
          origin: "ai",
        })
        .returning();

      await audit(user.id, "task.create", {
        actor: "ai",
        entityType: "task",
        entityId: task.id,
        meta: { proposalId: proposal.id, confirmed: true },
      });

      revalidatePath("/tasks");
      revalidatePath("/");
      return { ok: true, message: `Added "${task.title}" to your tasks.` };
    }

    case "schedule_event": {
      const p = proposal.payload as { title: string; startsAt: string; durationMinutes: number };
      const startsAt = new Date(p.startsAt);
      if (Number.isNaN(startsAt.getTime())) {
        return { ok: false, message: "That proposal had an invalid time." };
      }

      const [event] = await db
        .insert(events)
        .values({
          userId: user.id,
          title: p.title,
          startsAt,
          endsAt: new Date(startsAt.getTime() + (p.durationMinutes ?? 60) * 60_000),
          category: "focus",
          calendarName: "Life OS",
          origin: "ai",
        })
        .returning();

      await audit(user.id, "event.create", {
        actor: "ai",
        entityType: "event",
        entityId: event.id,
        meta: { proposalId: proposal.id, confirmed: true },
      });

      revalidatePath("/calendar");
      revalidatePath("/");
      return { ok: true, message: `Put "${event.title}" on your calendar.` };
    }

    default:
      return { ok: false, message: "That action is not supported." };
  }
}

export async function startNewConversation() {
  const user = await requireUser();
  const [created] = await db
    .insert(aiConversations)
    .values({ userId: user.id, title: "New conversation" })
    .returning();
  revalidatePath("/chief-of-staff");
  return created.id;
}

import { Suspense } from "react";
import type { Metadata } from "next";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiConversations, aiMessages } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/chief-of-staff";
import { ChiefOfStaffChat } from "@/components/ai/chief-of-staff-chat";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Chief of Staff" };

export default async function ChiefOfStaffPage() {
  const user = await requireUser();

  // Resume the most recent conversation so the assistant has continuity.
  const [latest] = await db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.userId, user.id))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(1);

  const messages = latest
    ? await db
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, latest.id))
        .orderBy(asc(aiMessages.createdAt))
        .limit(40)
    : [];

  return (
    <div className="animate-in">
      <PageHeader
        title="Chief of Staff"
        description="Reasons over your Life OS data and cites what it used. It proposes actions; you confirm them."
      />

      <Suspense fallback={null}>
        <ChiefOfStaffChat
          configured={aiConfigured()}
          initialConversationId={latest?.id ?? null}
          initialMessages={messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.content,
            citations: m.citations,
          }))}
        />
      </Suspense>
    </div>
  );
}

export const dynamic = "force-dynamic";

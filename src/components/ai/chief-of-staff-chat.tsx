"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, Check, Database, Loader2, Sparkles, X } from "lucide-react";
import {
  confirmProposal, sendChiefOfStaffMessage, type ChatResponse,
} from "@/lib/actions/ai";
import type { ToolProposal } from "@/lib/ai/tools";
import type { Citation } from "@/lib/ai/chief-of-staff";
import { Button, Card, ErrorState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Bubble = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  proposals?: ToolProposal[];
};

const SUGGESTIONS = [
  "What should I focus on today?",
  "What's slipping?",
  "Where did my time go this week?",
  "Which projects are at risk?",
  "What am I neglecting?",
  "What should I stop doing?",
];

function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <details className="mt-2.5">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-subtle hover:text-ink-muted">
        <Database className="size-3" />
        {citations.length} {citations.length === 1 ? "source" : "sources"} from your data
      </summary>
      <ul className="mt-1.5 space-y-1 border-l border-border pl-3">
        {citations.map((c, i) => (
          <li key={`${c.label}-${i}`} className="text-[11px] text-ink-subtle">
            <span className="font-medium text-ink-muted">{c.label}</span>
            {c.detail ? ` — ${c.detail}` : ""}
            <span className="text-ink-subtle"> ({c.source})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ProposalCard({ proposal }: { proposal: ToolProposal }) {
  const router = useRouter();
  const [state, setState] = useState<"pending" | "done" | "declined">("pending");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (state === "declined") {
    return (
      <p className="mt-2 text-[12px] text-ink-subtle">Declined: {proposal.summary}</p>
    );
  }

  return (
    <div className="mt-2.5 rounded-lg border border-border bg-surface-sunken p-3">
      <p className="text-[13px] text-ink">{proposal.summary}</p>

      {state === "done" ? (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-positive">
          <Check className="size-3.5" />
          {message}
        </p>
      ) : (
        <>
          <p className="mt-1 text-[11px] text-ink-subtle">
            Nothing has been written yet. This needs your confirmation.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  const result = await confirmProposal(proposal);
                  setMessage(result.message);
                  setState(result.ok ? "done" : "pending");
                  if (result.ok) router.refresh();
                })
              }
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState("declined")}>
              <X className="size-3.5" />
              Discard
            </Button>
          </div>
          {message && state === "pending" ? (
            <p className="mt-2 text-[12px] text-critical">{message}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ChiefOfStaffChat({
  configured,
  initialConversationId,
  initialMessages,
}: {
  configured: boolean;
  initialConversationId: string | null;
  initialMessages: Bubble[];
}) {
  const params = useSearchParams();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [bubbles, setBubbles] = useState<Bubble[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;
    setError(null);
    setInput("");
    setBubbles((b) => [...b, { id: crypto.randomUUID(), role: "user", text: trimmed }]);

    startTransition(async () => {
      const reply: ChatResponse = await sendChiefOfStaffMessage(conversationId, trimmed);
      if (reply.error) {
        setError(reply.error);
        return;
      }
      setConversationId(reply.conversationId);
      setBubbles((b) => [
        ...b,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: reply.text,
          citations: reply.citations,
          proposals: reply.proposals,
        },
      ]);
    });
  }

  // A deep link like /chief-of-staff?ask=... comes from Attention cards, so the
  // question fires once on arrival rather than making the user retype it.
  useEffect(() => {
    const preset = params.get("ask");
    if (preset && !asked.current) {
      asked.current = true;
      ask(preset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bubbles, pending]);

  return (
    <div className="flex min-h-[60vh] flex-col">
      {!configured ? (
        <div className="mb-4 rounded-lg border border-dashed border-border-strong bg-surface-sunken px-3.5 py-2.5 text-[13px] text-ink-muted">
          <span className="font-medium text-ink">No AI model connected.</span> Answers below are
          direct readouts of your own data. Add <code className="rounded bg-surface px-1">ANTHROPIC_API_KEY</code>{" "}
          to <code className="rounded bg-surface px-1">.env</code> for full reasoning.
        </div>
      ) : null}

      <div className="flex-1 space-y-4">
        {bubbles.length === 0 ? (
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Sparkles className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">Ask about your life, not the internet.</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  I read your tasks, projects, goals, calendar, health, money, people and habits, and
                  I cite what I used. If something is not connected, I will say so rather than guess.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-md border border-border px-2.5 py-1.5 text-[12px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </Card>
        ) : (
          bubbles.map((bubble) => (
            <div
              key={bubble.id}
              className={cn("flex", bubble.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[min(42rem,92%)] rounded-2xl px-4 py-2.5",
                  bubble.role === "user"
                    ? "bg-accent text-accent-ink"
                    : "border border-border bg-surface",
                )}
              >
                <div
                  className={cn(
                    "text-sm leading-relaxed whitespace-pre-wrap",
                    bubble.role === "user" ? "text-accent-ink" : "text-ink",
                  )}
                >
                  {bubble.text}
                </div>

                {bubble.role === "assistant" ? (
                  <>
                    {bubble.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} />)}
                    <CitationList citations={bubble.citations ?? []} />
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}

        {pending ? (
          <div className="flex items-center gap-2 text-[13px] text-ink-subtle">
            <Loader2 className="size-3.5 animate-spin" />
            Reading your data…
          </div>
        ) : null}

        {error ? <ErrorState title="Could not answer" description={error} /> : null}

        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 mt-5 bg-canvas pt-2 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-card focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder="Ask your Chief of Staff…"
            aria-label="Ask your Chief of Staff"
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim() || pending}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Clock, MoreHorizontal, Plus, Sparkles, X } from "lucide-react";
import type { AttentionSignal } from "@/lib/domain/attention";
import { createTaskFromSignal, dismissSignal, snoozeSignal } from "@/lib/actions/attention";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const SEVERITY_STYLE = {
  critical: "text-critical",
  high: "text-caution",
  normal: "text-ink-subtle",
} as const;

function SignalRow({ signal }: { signal: AttentionSignal }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<void>) {
    setMenuOpen(false);
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <li className={cn("group relative px-5 py-3.5", pending && "opacity-50")}>
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={cn("mt-0.5 size-4 shrink-0", SEVERITY_STYLE[signal.severity])}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{signal.title}</p>
          {/* The reason is the point of this panel, so it is never truncated. */}
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{signal.why}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
            <Link
              href={signal.href}
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              Investigate <ArrowRight className="size-3" />
            </Link>
            <Link
              href={`/chief-of-staff?ask=${encodeURIComponent(signal.askPrompt)}`}
              className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
            >
              <Sparkles className="size-3" /> Ask AI
            </Link>
            {signal.suggestedTask ? (
              <button
                type="button"
                onClick={() => run(() => createTaskFromSignal(signal.key, signal.suggestedTask!))}
                className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
              >
                <Plus className="size-3" /> Make a task
              </button>
            ) : null}
          </div>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`Options for ${signal.title}`}
            aria-expanded={menuOpen}
            className="flex size-8 items-center justify-center rounded-lg text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-sunken hover:text-ink"
          >
            <MoreHorizontal className="size-4" />
          </button>

          {menuOpen ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-raised">
                <button
                  type="button"
                  onClick={() => run(() => snoozeSignal(signal.key, 1))}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-muted hover:bg-surface-sunken hover:text-ink"
                >
                  <Clock className="size-3.5" /> Snooze a day
                </button>
                <button
                  type="button"
                  onClick={() => run(() => snoozeSignal(signal.key, 7))}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-muted hover:bg-surface-sunken hover:text-ink"
                >
                  <Clock className="size-3.5" /> Snooze a week
                </button>
                <button
                  type="button"
                  onClick={() => run(() => dismissSignal(signal.key))}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-muted hover:bg-surface-sunken hover:text-ink"
                >
                  <X className="size-3.5" /> Dismiss
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function AttentionPanel({ signals }: { signals: AttentionSignal[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? signals : signals.slice(0, 4);

  return (
    <Card>
      <CardHeader
        title="Attention required"
        action={
          signals.length > 4 ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[12px] text-ink-muted hover:text-ink"
            >
              {showAll ? "Show less" : `Show all ${signals.length}`}
            </button>
          ) : null
        }
      />
      {signals.length === 0 ? (
        <EmptyState
          icon={<Check className="size-5" />}
          title="Nothing needs your attention"
          description="No overdue work, stalled projects or unusual patterns right now."
        />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {visible.map((signal) => (
            <SignalRow key={signal.key} signal={signal} />
          ))}
        </ul>
      )}
    </Card>
  );
}

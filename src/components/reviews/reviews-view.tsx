"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, ClipboardList, Loader2, Pencil, Sparkles } from "lucide-react";
import type { Review, ReviewType } from "@/db/schema";
import {
  archiveReview, finaliseReview, generateReview, saveReviewSections,
} from "@/lib/actions/reviews";
import {
  Badge, Button, Card, CardHeader, EmptyState, Textarea,
} from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";

/** Section copy lives here so this client component never imports server code. */
const SECTION_LABELS: Record<string, string> = {
  wins: "What went well",
  problems: "What went badly",
  time: "Where time went",
  health: "Health",
  money: "Money",
  neglected: "Neglected areas",
  habits: "Habits",
  nextPeriod: "Next period",
  reflection: "Your reflection",
};

const ORDER = [
  "wins", "problems", "time", "health", "money", "neglected", "habits", "nextPeriod", "reflection",
];

function ReviewCard({ review }: { review: Review }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sections, setSections] = useState<Record<string, string>>(review.sections ?? {});
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <Card className={cn(pending && "opacity-70")}>
      <CardHeader
        title={`${review.type === "weekly" ? "Week of" : "Month of"} ${formatDate(new Date(`${review.periodStart}T12:00:00`), { day: "numeric", month: "long", year: "numeric" })}`}
        description={`${review.periodStart} to ${review.periodEnd}`}
        action={
          <div className="flex items-center gap-1.5">
            {review.status === "final" ? (
              <Badge tone="positive">Final</Badge>
            ) : (
              <Badge tone="neutral">Draft</Badge>
            )}
            {review.editedByUser ? <Badge tone="accent">Edited</Badge> : null}
            {review.origin === "ai" && !review.editedByUser ? (
              <Badge tone="neutral" title="Narrative drafted by AI from your data">
                <Sparkles className="size-2.5" />
                AI draft
              </Badge>
            ) : null}
          </div>
        }
      />

      <div className="space-y-4 border-t border-border px-5 py-4">
        {ORDER.filter((key) => editing || (sections[key] ?? "").trim()).map((key) => (
          <section key={key}>
            <h3 className="mb-1 text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
              {SECTION_LABELS[key] ?? key}
            </h3>
            {editing ? (
              <Textarea
                value={sections[key] ?? ""}
                onChange={(e) => setSections((s) => ({ ...s, [key]: e.target.value }))}
                rows={3}
                aria-label={SECTION_LABELS[key] ?? key}
                className="min-h-16 text-[13px]"
              />
            ) : (
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                {sections[key]}
              </p>
            )}
          </section>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
        {editing ? (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setEditing(false);
                run(() => saveReviewSections(review.id, sections));
              }}
            >
              <Check className="size-3.5" />
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
            {review.status !== "final" ? (
              <Button size="sm" variant="ghost" onClick={() => run(() => finaliseReview(review.id))}>
                <Check className="size-3.5" />
                Mark final
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => run(() => archiveReview(review.id))}
            >
              <Archive className="size-3.5" />
              Archive
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export function ReviewsView({
  reviews,
  aiEnabled,
  pendingWeekly,
  pendingMonthly,
  autoGenerate,
}: {
  reviews: Review[];
  aiEnabled: boolean;
  pendingWeekly: boolean;
  pendingMonthly: boolean;
  autoGenerate: ReviewType | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [generating, setGenerating] = useState<ReviewType | null>(null);
  const fired = useRef(false);

  function generate(type: ReviewType) {
    setGenerating(type);
    startTransition(async () => {
      await generateReview(type);
      setGenerating(null);
      router.refresh();
    });
  }

  // /reviews?generate=weekly comes from the command palette and the Attention
  // panel, so the review builds itself on arrival.
  useEffect(() => {
    if (autoGenerate && !fired.current) {
      fired.current = true;
      generate(autoGenerate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate]);

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          variant={pendingWeekly ? "primary" : "secondary"}
          size="sm"
          disabled={pending}
          onClick={() => generate("weekly")}
        >
          {generating === "weekly" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {pendingWeekly ? "Review last week" : "Regenerate weekly"}
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => generate("monthly")}>
          {generating === "monthly" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {pendingMonthly ? "Review last month" : "Regenerate monthly"}
        </Button>

        {!aiEnabled ? (
          <p className="w-full text-[12px] text-ink-subtle">
            No AI key configured, so reviews are generated directly from your data without narrative
            rewriting. Every number is the same either way.
          </p>
        ) : null}
      </div>

      {reviews.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="No reviews yet"
            description="A weekly review is what turns a pile of records into something you can steer by. It takes about five minutes."
            action={
              <Button variant="primary" size="sm" onClick={() => generate("weekly")} disabled={pending}>
                Start your first weekly review
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </>
  );
}

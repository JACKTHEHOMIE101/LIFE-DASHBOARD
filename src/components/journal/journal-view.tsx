"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Check, Loader2, NotebookPen, Search } from "lucide-react";
import type { JournalEntry } from "@/db/schema";
import { saveJournalEntry, type JournalState } from "@/lib/actions/journal";
import {
  Button, Card, CardHeader, EmptyState, Input, Label, Textarea,
} from "@/components/ui/primitives";
import { cn, formatLongDate, isoDate } from "@/lib/utils";

const SCALES = [
  { name: "mood", label: "Mood" },
  { name: "energy", label: "Energy" },
  { name: "productivity", label: "Productivity" },
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      Save entry
    </Button>
  );
}

/** Five-point scale rendered as radio buttons so it stays keyboard-navigable. */
function ScaleField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: number | null;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-ink-muted">{label}</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className={cn(
              "flex size-9 cursor-pointer items-center justify-center rounded-lg border text-[13px] transition-colors",
              value === n
                ? "border-transparent bg-accent text-accent-ink"
                : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => setValue(n)}
              className="sr-only"
            />
            {n}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function JournalView({
  date,
  entry,
  entries,
  query,
}: {
  date: string;
  entry: JournalEntry | null;
  entries: JournalEntry[];
  query: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<JournalState, FormData>(saveJournalEntry, {});
  const [search, setSearch] = useState(query);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      setSaved(true);
      router.refresh();
      const id = setTimeout(() => setSaved(false), 2500);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader
          title={isoDate(new Date()) === date ? "Today" : formatLongDate(new Date(`${date}T12:00:00`))}
          description={entry ? "Editing an existing entry" : "New entry"}
          action={
            saved ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-positive">
                <Check className="size-3.5" />
                Saved
              </span>
            ) : null
          }
        />

        <form action={formAction} className="space-y-4 border-t border-border px-5 py-4">
          <input type="hidden" name="date" value={date} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {SCALES.map((s) => (
              <ScaleField
                key={s.name}
                name={s.name}
                label={s.label}
                defaultValue={(entry?.[s.name] as number | null) ?? null}
              />
            ))}
          </div>

          <div>
            <Label htmlFor="j-wins">What went well</Label>
            <Textarea id="j-wins" name="wins" rows={2} className="min-h-16" defaultValue={entry?.wins ?? ""} />
          </div>

          <div>
            <Label htmlFor="j-challenges">What was hard</Label>
            <Textarea
              id="j-challenges"
              name="challenges"
              rows={2}
              className="min-h-16"
              defaultValue={entry?.challenges ?? ""}
            />
          </div>

          <div>
            <Label htmlFor="j-gratitude">Grateful for</Label>
            <Input id="j-gratitude" name="gratitude" defaultValue={entry?.gratitude ?? ""} />
          </div>

          <div>
            <Label htmlFor="j-notes">Anything else</Label>
            <Textarea id="j-notes" name="notes" rows={4} defaultValue={entry?.notes ?? ""} />
          </div>

          <div>
            <Label htmlFor="j-priority">Tomorrow&apos;s one priority</Label>
            <Input
              id="j-priority"
              name="tomorrowPriority"
              defaultValue={entry?.tomorrowPriority ?? ""}
              placeholder="If only one thing happens, this one"
            />
          </div>

          {state?.error ? (
            <p role="alert" className="text-[13px] text-critical">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Submit />
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Past entries" />
        <div className="border-t border-border px-5 py-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/journal?q=${encodeURIComponent(search)}`);
            }}
          >
            <Search className="absolute top-2.5 left-2.5 size-3.5 text-ink-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your journal"
              aria-label="Search journal"
              className="h-9 py-0 pl-8 text-[13px]"
            />
          </form>
        </div>

        {entries.length === 0 ? (
          <EmptyState
            icon={<NotebookPen className="size-5" />}
            title={query ? "Nothing matches" : "No entries yet"}
            description={
              query
                ? "Try a different word."
                : "Two minutes a day is enough for the weekly review to have something real to work with."
            }
          />
        ) : (
          <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto border-t border-border">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/journal?date=${e.date}`)}
                  className={cn(
                    "w-full px-5 py-3 text-left transition-colors hover:bg-surface-sunken",
                    e.date === date && "bg-surface-sunken",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">
                      {formatLongDate(new Date(`${e.date}T12:00:00`))}
                    </span>
                    {e.mood ? (
                      <span className="text-[11px] text-ink-subtle">Mood {e.mood}/5</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-muted">
                    {e.wins || e.notes || e.challenges || "No text"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

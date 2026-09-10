"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Flame, Repeat } from "lucide-react";
import type { HabitSummary } from "@/lib/domain/habits";
import { toggleHabitToday } from "@/lib/actions/habits";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

function HabitChip({ habit }: { habit: HabitSummary }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [done, setDone] = useOptimistic(habit.doneToday);

  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          setDone(!done);
          await toggleHabitToday(habit.id, !done);
          router.refresh();
        })
      }
      aria-pressed={done}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
        done
          ? "border-transparent bg-positive-soft text-positive"
          : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
      )}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          done ? "border-positive bg-positive text-white" : "border-border-strong",
        )}
      >
        {done ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
      </span>
      <span className="truncate">{habit.name}</span>
      {habit.showsStreak && habit.streak > 1 ? (
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] text-ink-subtle">
          <Flame className="size-3" />
          {habit.streak}
        </span>
      ) : null}
    </button>
  );
}

export function HabitsStrip({ habits }: { habits: HabitSummary[] }) {
  return (
    <Card>
      <CardHeader title="Habits" />
      {habits.length === 0 ? (
        <EmptyState
          icon={<Repeat className="size-5" />}
          title="No habits yet"
          description="A small number of habits, tracked honestly, beats a long list you ignore."
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 border-t border-border px-5 py-4 sm:grid-cols-2">
          {habits.map((habit) => (
            <HabitChip key={habit.id} habit={habit} />
          ))}
        </div>
      )}
    </Card>
  );
}

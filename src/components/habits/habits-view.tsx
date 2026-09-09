"use client";

import { useActionState, useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Archive, Check, Flame, Loader2, Plus, Repeat } from "lucide-react";
import type { HabitSummary } from "@/lib/domain/habits";
import type { PaletteArea } from "@/lib/domain/search-types";
import { archiveHabit, createHabit, toggleHabitToday } from "@/lib/actions/habits";
import { Overlay } from "@/components/ui/overlay";
import { Meter } from "@/components/ui/charts";
import {
  AreaDot, Button, Card, EmptyState, Input, Label, Select, Textarea,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Add habit
    </Button>
  );
}

/** 30-day grid. Each cell is one day; today is the rightmost. */
function ConsistencyGrid({ days, color }: { days: { date: string; done: boolean }[]; color: string }) {
  return (
    <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`${days.filter((d) => d.done).length} of the last 30 days completed`}>
      {days.map((day) => (
        <span
          key={day.date}
          title={`${day.date}: ${day.done ? "done" : "missed"}`}
          className="size-2.5 rounded-[3px]"
          style={{
            backgroundColor: day.done
              ? `var(--color-area-${color})`
              : "var(--color-surface-sunken)",
            outline: day.done ? "none" : "1px solid var(--color-border)",
            outlineOffset: "-1px",
          }}
        />
      ))}
    </div>
  );
}

function HabitCard({ habit }: { habit: HabitSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useOptimistic(habit.doneToday);

  return (
    <Card className={cn("p-4", pending && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-ink">{habit.name}</h3>
            {habit.streak > 1 ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-ink-subtle">
                <Flame className="size-3" />
                {habit.streak}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-subtle">
            {habit.frequency === "daily" ? "Daily" : "Weekly"}
            {habit.areaName ? " · " : ""}
            {habit.areaName ? (
              <span className="inline-flex items-center gap-1">
                <AreaDot color={habit.areaColor ?? "slate"} />
                {habit.areaName}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={done ? `Undo ${habit.name} for today` : `Complete ${habit.name} today`}
            aria-pressed={done}
            onClick={() =>
              startTransition(async () => {
                setDone(!done);
                await toggleHabitToday(habit.id, !done);
                router.refresh();
              })
            }
            className={cn(
              "flex size-9 items-center justify-center rounded-lg border transition-colors",
              done
                ? "border-transparent bg-positive text-white"
                : "border-border text-ink-subtle hover:border-accent hover:text-accent",
            )}
          >
            <Check className="size-4" strokeWidth={done ? 3 : 2} />
          </button>
          <button
            type="button"
            aria-label={`Archive ${habit.name}`}
            onClick={() =>
              startTransition(async () => {
                await archiveHabit(habit.id);
                router.refresh();
              })
            }
            className="flex size-8 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            <Archive className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
          <span className="text-ink-muted">30-day consistency</span>
          <span className="font-medium text-ink tabular" data-numeric>
            {Math.round(habit.consistency * 100)}%
          </span>
        </div>
        <Meter
          value={habit.consistency}
          tone={habit.consistency >= 0.7 ? "positive" : habit.consistency >= 0.4 ? "accent" : "caution"}
          size="sm"
          label={`${habit.name} consistency`}
        />
      </div>

      {habit.frequency === "daily" ? (
        <div className="mt-3">
          <ConsistencyGrid days={habit.last30} color={habit.color} />
        </div>
      ) : null}
    </Card>
  );
}

export function HabitsView({
  habits,
  goals,
  lifeAreas,
}: {
  habits: HabitSummary[];
  goals: { id: string; title: string }[];
  lifeAreas: PaletteArea[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createHabit, { error: undefined });

  useEffect(() => {
    if (state && !state.error) {
      router.refresh();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          {habits.length} active · {habits.filter((h) => h.doneToday).length} done today
        </p>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          New habit
        </Button>
      </div>

      {habits.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Repeat className="size-5" />}
            title="No habits yet"
            description="Start with two or three. Consistency over thirty days tells you more than a perfect first week."
            action={
              <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                Add your first habit
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {habits.map((habit) => (
            <HabitCard key={habit.id} habit={habit} />
          ))}
        </div>
      )}

      <Overlay open={open} onClose={() => setOpen(false)} labelledBy="habit-form-title" align="center">
        <form action={formAction} className="p-5">
          <h2 id="habit-form-title" className="mb-4 text-base font-semibold text-ink">
            New habit
          </h2>
          <div className="space-y-3.5">
            <div>
              <Label htmlFor="h-name">Habit</Label>
              <Input id="h-name" name="name" required autoFocus placeholder="Move for 30 minutes" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="h-freq">Frequency</Label>
                <Select id="h-freq" name="frequency" defaultValue="daily">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="h-area">Life area</Label>
                <Select id="h-area" name="lifeAreaId" defaultValue="">
                  <option value="">None</option>
                  {lifeAreas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="h-goal">Supports goal</Label>
              <Select id="h-goal" name="goalId" defaultValue="">
                <option value="">None</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="h-notes">Notes</Label>
              <Textarea id="h-notes" name="notes" rows={2} className="min-h-16" />
            </div>
          </div>

          {state?.error ? (
            <p role="alert" className="mt-3 text-[13px] text-critical">
              {state.error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Submit />
          </div>
        </form>
      </Overlay>
    </>
  );
}

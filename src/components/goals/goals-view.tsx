"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Loader2, Pencil, Plus, Target } from "lucide-react";
import type { GoalSummary } from "@/lib/domain/goals";
import { GOAL_STATUS_LABEL } from "@/lib/domain/labels";
import type { PaletteArea } from "@/lib/domain/search-types";
import { createGoal, updateGoal, type GoalState } from "@/lib/actions/goals";
import { Meter } from "@/components/ui/charts";
import { Overlay } from "@/components/ui/overlay";
import {
  AreaDot, Badge, Button, Card, EmptyState, Input, Label, Select, Textarea,
} from "@/components/ui/primitives";
import { cn, formatDate, pluralise } from "@/lib/utils";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending ? "Saving…" : label}
    </Button>
  );
}

function GoalForm({
  open,
  onClose,
  lifeAreas,
  goal,
}: {
  open: boolean;
  onClose: () => void;
  lifeAreas: PaletteArea[];
  goal?: GoalSummary | null;
}) {
  const router = useRouter();
  const editing = Boolean(goal);
  const [state, formAction] = useActionState<GoalState, FormData>(
    editing ? updateGoal : createGoal,
    {},
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <Overlay open={open} onClose={onClose} labelledBy="goal-form-title" align="center">
      <form action={formAction} className="max-h-[80vh] overflow-y-auto p-5">
        <h2 id="goal-form-title" className="mb-4 text-base font-semibold text-ink">
          {editing ? "Edit goal" : "New goal"}
        </h2>
        {goal ? <input type="hidden" name="id" value={goal.id} /> : null}

        <div className="space-y-3.5">
          <div>
            <Label htmlFor="g-title">Goal</Label>
            <Input id="g-title" name="title" required autoFocus defaultValue={goal?.title ?? ""} />
          </div>

          <div>
            <Label htmlFor="g-why">Why this matters</Label>
            <Textarea
              id="g-why"
              name="why"
              rows={2}
              className="min-h-16"
              defaultValue={goal?.why ?? ""}
              placeholder="The reason you will still care in six months."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="g-status">Status</Label>
              <Select id="g-status" name="status" defaultValue={goal?.status ?? "active"}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="achieved">Achieved</option>
                <option value="abandoned">Abandoned</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="g-target-date">Target date</Label>
              <Input
                id="g-target-date"
                name="targetDate"
                type="date"
                defaultValue={iso(goal?.targetDate ?? null)}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="g-area">Life area</Label>
              <Select id="g-area" name="lifeAreaId" defaultValue={goal?.lifeAreaId ?? ""}>
                <option value="">None</option>
                {lifeAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-[12px] text-ink-muted">
              Measurement (optional, but it is what makes progress real)
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="g-metric">Metric</Label>
                <Input
                  id="g-metric"
                  name="metricName"
                  defaultValue={goal?.metricName ?? ""}
                  placeholder="Net worth"
                />
              </div>
              <div>
                <Label htmlFor="g-unit">Unit</Label>
                <Input id="g-unit" name="metricUnit" defaultValue={goal?.metricUnit ?? ""} placeholder="USD" />
              </div>
              <div>
                <Label htmlFor="g-start">Start</Label>
                <Input id="g-start" name="startValue" type="number" step="any" defaultValue={goal?.startValue ?? ""} />
              </div>
              <div>
                <Label htmlFor="g-current">Current</Label>
                <Input id="g-current" name="currentValue" type="number" step="any" defaultValue={goal?.currentValue ?? ""} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="g-target">Target</Label>
                <Input id="g-target" name="targetValue" type="number" step="any" defaultValue={goal?.targetValue ?? ""} />
              </div>
            </div>
          </fieldset>
        </div>

        {state?.error ? (
          <p role="alert" className="mt-3 text-[13px] text-critical">
            {state.error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Submit label={editing ? "Save changes" : "Create goal"} />
        </div>
      </form>
    </Overlay>
  );
}

function GoalCard({ goal, onEdit }: { goal: GoalSummary; onEdit: () => void }) {
  const progress = goal.progress;
  const metric =
    goal.currentValue !== null && goal.targetValue !== null
      ? `${goal.currentValue.toLocaleString()} of ${goal.targetValue.toLocaleString()}${
          goal.metricUnit && goal.metricUnit !== "USD" ? ` ${goal.metricUnit}` : ""
        }`
      : null;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-ink">{goal.title}</h3>
            {goal.isNeglected ? (
              <Badge tone="caution">
                <AlertTriangle className="size-2.5" />
                No recent progress
              </Badge>
            ) : goal.behindSchedule ? (
              <Badge tone="caution">Behind timeline</Badge>
            ) : null}
            {goal.status !== "active" ? (
              <Badge tone="neutral">{GOAL_STATUS_LABEL[goal.status]}</Badge>
            ) : null}
          </div>
          {goal.why ? <p className="mt-1 text-[13px] text-ink-muted">{goal.why}</p> : null}
        </div>

        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${goal.title}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>

      {progress !== null ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-ink-muted">{metric ?? "Progress"}</span>
            <span className="font-medium text-ink tabular" data-numeric>
              {Math.round(progress * 100)}%
            </span>
          </div>
          <Meter
            value={progress}
            tone={goal.isNeglected || goal.behindSchedule ? "caution" : "accent"}
            label={`${goal.title} progress`}
          />
          {/* Time elapsed sits under the bar so progress is judged against the
              clock rather than in isolation. */}
          {goal.timeElapsed !== null ? (
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              {Math.round(goal.timeElapsed * 100)}% of the time to target has passed
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-ink-subtle">
          No metric set, so progress cannot be measured. Add one to track it honestly.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[12px] text-ink-subtle">
        {goal.areaName ? (
          <span className="inline-flex items-center gap-1.5">
            <AreaDot color={goal.areaColor ?? "slate"} />
            {goal.areaName}
          </span>
        ) : null}
        {goal.targetDate ? <span>Target {formatDate(goal.targetDate)}</span> : null}
        {goal.projectCount > 0 ? <span>{pluralise(goal.projectCount, "project")}</span> : null}
        {goal.daysSinceProgress !== null ? (
          <span className={cn(goal.isNeglected && "text-caution")}>
            Last moved {goal.daysSinceProgress === 0 ? "today" : `${goal.daysSinceProgress}d ago`}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export function GoalsView({
  goals,
  lifeAreas,
  openNew,
}: {
  goals: GoalSummary[];
  lifeAreas: PaletteArea[];
  openNew?: boolean;
}) {
  const [formOpen, setFormOpen] = useState(Boolean(openNew));
  const [editing, setEditing] = useState<GoalSummary | null>(null);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          {goals.length} active
          {goals.filter((g) => g.isNeglected).length > 0
            ? ` · ${goals.filter((g) => g.isNeglected).length} without recent progress`
            : ""}
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          New goal
        </Button>
      </div>

      {goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="size-5" />}
            title="No goals yet"
            description="Goals give projects a reason to exist. Give each one a metric so progress is something you can see rather than something you feel."
            action={
              <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                Set your first goal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={() => {
                setEditing(goal);
                setFormOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <GoalForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        lifeAreas={lifeAreas}
        goal={editing}
      />
    </>
  );
}

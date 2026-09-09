"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Archive, ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import type { LifeArea } from "@/db/schema";
import type { PulseStatus } from "@/lib/domain/pulse";
import {
  createLifeArea, moveLifeArea, renameLifeArea, setAreaArchived, type AreaState,
} from "@/lib/actions/life-areas";
import { TrendIndicator } from "@/components/ui/charts";
import { Overlay } from "@/components/ui/overlay";
import {
  AreaDot, Button, Card, Input, Label, Select, Textarea,
} from "@/components/ui/primitives";
import { cn, pluralise } from "@/lib/utils";

const COLORS = ["indigo", "emerald", "rose", "amber", "orange", "violet", "cyan", "teal", "slate"];

type AreaRow = LifeArea & {
  projectCount: number;
  goalCount: number;
  taskCount: number;
  status: PulseStatus;
  statusLabel: string;
  headline: string;
  direction: "up" | "down" | "flat";
};

const STATUS_TONE: Record<PulseStatus, string> = {
  strong: "text-positive",
  steady: "text-ink-muted",
  attention: "text-caution",
  no_data: "text-ink-subtle",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Add area
    </Button>
  );
}

function AreaCard({ area, canMoveUp, canMoveDown }: { area: AreaRow; canMoveUp: boolean; canMoveDown: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(area.name);
  const [color, setColor] = useState(area.color);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <Card className={cn("p-4", pending && "opacity-60", area.archivedAt && "opacity-60")}>
      {editing ? (
        <div className="space-y-2.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Area name" />
          <Select value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour">
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setEditing(false);
                run(() => renameLifeArea(area.id, name, color));
              }}
            >
              <Check className="size-3.5" />
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <AreaDot color={area.color} />
                <h3 className="truncate text-sm font-medium text-ink">{area.name}</h3>
                {area.archivedAt ? (
                  <span className="text-[11px] text-ink-subtle">Archived</span>
                ) : null}
              </div>
              <p className={cn("mt-1 text-[13px]", STATUS_TONE[area.status])}>
                {area.statusLabel}
                {area.headline && area.status !== "no_data" ? (
                  <span className="text-ink-subtle"> · {area.headline}</span>
                ) : null}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              {area.direction !== "flat" ? (
                <TrendIndicator direction={area.direction} className="mr-1">
                  <span className="sr-only">Trending {area.direction}</span>
                </TrendIndicator>
              ) : null}
              <button
                type="button"
                aria-label={`Edit ${area.name}`}
                onClick={() => setEditing(true)}
                className="flex size-7 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-sunken hover:text-ink"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={area.archivedAt ? `Restore ${area.name}` : `Archive ${area.name}`}
                onClick={() => run(() => setAreaArchived(area.id, !area.archivedAt))}
                className="flex size-7 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-sunken hover:text-ink"
              >
                {area.archivedAt ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-2.5 text-[12px] text-ink-subtle">
            <span>
              {pluralise(area.goalCount, "goal")} · {pluralise(area.projectCount, "project")} ·{" "}
              {pluralise(area.taskCount, "task")}
            </span>
            <span className="flex gap-0.5">
              <button
                type="button"
                aria-label={`Move ${area.name} up`}
                disabled={!canMoveUp}
                onClick={() => run(() => moveLifeArea(area.id, "up"))}
                className="flex size-6 items-center justify-center rounded text-ink-subtle hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
              >
                <ArrowUp className="size-3" />
              </button>
              <button
                type="button"
                aria-label={`Move ${area.name} down`}
                disabled={!canMoveDown}
                onClick={() => run(() => moveLifeArea(area.id, "down"))}
                className="flex size-6 items-center justify-center rounded text-ink-subtle hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
              >
                <ArrowDown className="size-3" />
              </button>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

export function LifeAreasView({ areas }: { areas: AreaRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<AreaState, FormData>(createLifeArea, {});

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const active = areas.filter((a) => !a.archivedAt);
  const archived = areas.filter((a) => a.archivedAt);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">{active.length} active areas</p>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          New area
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {active.map((area, i) => (
          <AreaCard
            key={area.id}
            area={area}
            canMoveUp={i > 0}
            canMoveDown={i < active.length - 1}
          />
        ))}
      </div>

      {archived.length > 0 ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-[13px] text-ink-subtle hover:text-ink-muted">
            {archived.length} archived
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {archived.map((area) => (
              <AreaCard key={area.id} area={area} canMoveUp={false} canMoveDown={false} />
            ))}
          </div>
        </details>
      ) : null}

      <Overlay open={open} onClose={() => setOpen(false)} labelledBy="area-form-title" align="center">
        <form action={formAction} className="p-5">
          <h2 id="area-form-title" className="mb-4 text-base font-semibold text-ink">
            New life area
          </h2>
          <div className="space-y-3.5">
            <div>
              <Label htmlFor="a-name">Name</Label>
              <Input id="a-name" name="name" required autoFocus placeholder="Creative work" />
            </div>
            <div>
              <Label htmlFor="a-desc">Description</Label>
              <Textarea id="a-desc" name="description" rows={2} className="min-h-16" />
            </div>
            <div>
              <Label htmlFor="a-color">Colour</Label>
              <Select id="a-color" name="color" defaultValue="slate">
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
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

"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock } from "lucide-react";
import type { TaskWithContext } from "@/lib/domain/tasks";
import { setTaskDone } from "@/lib/actions/tasks";
import { AreaDot, Badge, DemoBadge } from "@/components/ui/primitives";
import { cn, daysBetween, formatDate, formatDuration, relativeDay } from "@/lib/utils";

const PRIORITY_TONE = {
  must: "critical",
  should: "caution",
  could: "neutral",
} as const;

const PRIORITY_SHORT = { must: "Must", should: "Should", could: "Could" } as const;

/**
 * One task, everywhere. Completion is optimistic so the tick lands instantly
 * even though the write is a round trip; the router refresh then reconciles
 * every other count on the page.
 */
export function TaskRow({
  task,
  showProject = true,
  onSelect,
  compact = false,
}: {
  task: TaskWithContext;
  showProject?: boolean;
  onSelect?: (task: TaskWithContext) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [done, setDone] = useOptimistic(task.status === "done");

  const overdue = task.dueDate && task.status !== "done" && daysBetween(new Date(), task.dueDate) < 0;
  const duration = formatDuration(task.estimatedMinutes);

  function toggle() {
    startTransition(async () => {
      setDone(!done);
      await setTaskDone(task.id, !done);
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "group flex items-start gap-3",
        compact ? "py-2" : "py-2.5",
        onSelect && "cursor-pointer",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        aria-pressed={done}
        className={cn(
          // 44px hit area via padding while the visible control stays small.
          "-m-2 mt-[-0.4rem] flex size-9 shrink-0 items-center justify-center p-2",
        )}
      >
        <span
          className={cn(
            "flex size-[18px] items-center justify-center rounded-md border transition-all",
            done
              ? "border-positive bg-positive text-white"
              : "border-border-strong group-hover:border-accent",
          )}
        >
          {done ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      </button>

      <div className="min-w-0 flex-1" onClick={() => onSelect?.(task)}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p
            className={cn(
              "text-sm leading-snug",
              done ? "text-ink-subtle line-through" : "text-ink",
            )}
          >
            {task.title}
          </p>
          {task.isDemo ? <DemoBadge /> : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-subtle">
          {task.priority !== "could" && !done ? (
            <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_SHORT[task.priority]}</Badge>
          ) : null}

          {task.dueDate && !done ? (
            <span className={cn(overdue && "font-medium text-critical")}>
              {overdue ? `Overdue · ${formatDate(task.dueDate)}` : relativeDay(task.dueDate)}
            </span>
          ) : null}

          {duration ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {duration}
            </span>
          ) : null}

          {showProject && task.projectTitle ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {task.areaColor ? <AreaDot color={task.areaColor} /> : null}
              <span className="truncate">{task.projectTitle}</span>
            </span>
          ) : showProject && task.areaName ? (
            <span className="inline-flex items-center gap-1.5">
              <AreaDot color={task.areaColor ?? "slate"} />
              {task.areaName}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

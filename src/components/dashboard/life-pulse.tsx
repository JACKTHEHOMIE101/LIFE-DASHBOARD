"use client";

import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import type { AreaPulse, PulseStatus } from "@/lib/domain/pulse";
import { AreaDot, Card, CardHeader } from "@/components/ui/primitives";
import { TrendIndicator } from "@/components/ui/charts";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<PulseStatus, string> = {
  strong: "text-positive",
  steady: "text-ink-muted",
  attention: "text-caution",
  no_data: "text-ink-subtle",
};

function AreaRow({
  pulse,
  direction,
}: {
  pulse: AreaPulse;
  direction: "up" | "down" | "flat";
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = pulse.signals.length > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className={cn(
          "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors",
          hasDetail && "hover:bg-surface-sunken",
        )}
      >
        <AreaDot color={pulse.color} />
        <span className="w-28 shrink-0 truncate text-sm text-ink">{pulse.name}</span>

        <span className={cn("shrink-0 text-[13px] font-medium", STATUS_TONE[pulse.status])}>
          {pulse.statusLabel}
        </span>

        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-subtle">
          {pulse.status === "no_data" ? "" : pulse.headline}
        </span>

        {direction !== "flat" ? (
          <TrendIndicator direction={direction} goodDirection="up" className="shrink-0">
            <span className="sr-only">Trending {direction}</span>
          </TrendIndicator>
        ) : null}

        {hasDetail ? (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-ink-subtle transition-transform",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>

      {open ? (
        <div className="border-t border-border bg-surface-sunken px-5 py-3">
          <ul className="space-y-2">
            {pulse.signals.map((signal) => (
              <li key={signal.label} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink-muted">{signal.label}</span>
                <span className="text-right">
                  <span className="font-medium text-ink">{signal.value}</span>
                  {signal.change ? (
                    <span className="ml-2 text-ink-subtle">{signal.change}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          {/* The brief asks for a transparent model, so the rules are readable
              in place rather than described as a proprietary score. */}
          <details className="mt-3">
            <summary className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-subtle hover:text-ink-muted">
              <Info className="size-3" /> How this is measured
            </summary>
            <ul className="mt-1.5 space-y-1 pl-4 text-[12px] text-ink-subtle">
              {pulse.methodology.map((line) => (
                <li key={line} className="list-disc">
                  {line}
                </li>
              ))}
              <li className="list-disc">
                Status is the share of these signals that are healthy: 70% or more reads Strong,
                45% or more reads Steady, below that reads Needs attention.
              </li>
            </ul>
          </details>
        </div>
      ) : null}
    </li>
  );
}

export function LifePulse({
  areas,
}: {
  areas: (AreaPulse & { direction: "up" | "down" | "flat" })[];
}) {
  const tracked = areas.filter((a) => a.status !== "no_data");
  const untracked = areas.length - tracked.length;

  return (
    <Card>
      <CardHeader
        title="Life pulse"
        description={
          untracked > 0
            ? `${untracked} ${untracked === 1 ? "area has" : "areas have"} nothing recorded yet`
            : undefined
        }
      />
      <ul className="divide-y divide-border border-t border-border">
        {areas.map((pulse) => (
          <AreaRow key={pulse.areaId} pulse={pulse} direction={pulse.direction} />
        ))}
      </ul>
    </Card>
  );
}

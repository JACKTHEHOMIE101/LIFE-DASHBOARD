import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Small, quiet chart primitives. Every one of these is a single-series figure,
 * so none of them carries a legend: the surrounding label says what is plotted.
 *
 * Shared mark specs: 2px lines with round caps, columns capped at 24px with a
 * 4px rounded data-end and a square baseline, a 2px surface gap between
 * neighbouring bars, and end markers ringed in the surface colour so they stay
 * legible where they cross the line.
 */

export type ChartTone = "accent" | "positive" | "caution" | "critical" | "muted";

const toneVar: Record<ChartTone, string> = {
  accent: "var(--color-accent)",
  positive: "var(--color-positive)",
  caution: "var(--color-caution)",
  critical: "var(--color-critical)",
  muted: "var(--color-ink-subtle)",
};

/* -------------------------------------------------------------- sparkline */

export function Sparkline({
  values,
  tone = "accent",
  className,
  height = 32,
  width = 120,
  label,
}: {
  values: number[];
  tone?: ChartTone;
  className?: string;
  height?: number;
  width?: number;
  label?: string;
}) {
  if (values.length < 2) {
    return (
      <div
        className={cn("flex items-center text-[11px] text-ink-subtle", className)}
        style={{ height }}
      >
        Not enough data
      </div>
    );
  }

  const color = toneVar[tone];
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; draw it down the middle instead.
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (values.length - 1);

  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${points.at(-1)![0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;
  const [lastX, lastY] = points.at(-1)!;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? "Trend"}
      preserveAspectRatio="none"
    >
      <path d={area} fill={color} opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Surface ring keeps the end marker readable wherever the line lands. */}
      <circle cx={lastX} cy={lastY} r={4} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
    </svg>
  );
}

/* --------------------------------------------------------------- columns */

export function MiniBars({
  data,
  tone = "accent",
  height = 56,
  className,
  formatValue = (v) => String(Math.round(v)),
}: {
  data: { label: string; value: number; muted?: boolean }[];
  tone?: ChartTone;
  height?: number;
  className?: string;
  formatValue?: (value: number) => string;
}) {
  if (!data.length) {
    return <p className={cn("text-[11px] text-ink-subtle", className)}>No data yet</p>;
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const color = toneVar[tone];

  return (
    <div className={cn("flex items-end gap-[2px]", className)} style={{ height }}>
      {data.map((d, i) => {
        const ratio = Math.max(d.value / max, 0);
        return (
          <div
            key={`${d.label}-${i}`}
            className="group relative flex min-w-0 flex-1 flex-col justify-end"
            style={{ height }}
            title={`${d.label}: ${formatValue(d.value)}`}
          >
            <div
              className="w-full max-w-6 self-center rounded-t-[4px] transition-opacity"
              style={{
                height: `${Math.max(ratio * 100, d.value > 0 ? 3 : 1)}%`,
                backgroundColor: d.muted ? "var(--color-border-strong)" : color,
                opacity: d.muted ? 1 : 0.9,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- ranked bars */

/** Horizontal bars with the value at the tip. Used for spending by category. */
export function RankedBars({
  data,
  tone = "accent",
  className,
  formatValue = (v) => String(Math.round(v)),
}: {
  data: { label: string; value: number; note?: string; tone?: ChartTone }[];
  tone?: ChartTone;
  className?: string;
  formatValue?: (value: number) => string;
}) {
  if (!data.length) {
    return <p className={cn("text-sm text-ink-subtle", className)}>No data yet</p>;
  }
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);

  return (
    <ul className={cn("space-y-2.5", className)}>
      {data.map((d) => (
        <li key={d.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{d.label}</span>
            <span className="shrink-0 font-medium text-ink tabular" data-numeric>
              {formatValue(d.value)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(Math.abs(d.value) / max) * 100}%`,
                backgroundColor: toneVar[d.tone ?? tone],
              }}
            />
          </div>
          {d.note ? <p className="mt-1 text-[11px] text-ink-subtle">{d.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ meter */

/**
 * Progress toward a target. The fill carries severity and the track is a
 * washed step of the same colour, so the state reads across the whole bar.
 */
export function Meter({
  value,
  tone = "accent",
  className,
  size = "md",
  label,
}: {
  /** 0 to 1. Values above 1 are clamped but styled as over-target. */
  value: number;
  tone?: ChartTone;
  className?: string;
  size?: "sm" | "md";
  label?: string;
}) {
  const ratio = Math.max(0, Math.min(1, value));
  const color = toneVar[tone];
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full",
        size === "sm" ? "h-1.5" : "h-2",
        className,
      )}
      style={{ backgroundColor: `color-mix(in oklch, ${color} 14%, var(--color-surface-sunken))` }}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${ratio * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

/* -------------------------------------------------------------- indicators */

export type TrendDirection = "up" | "down" | "flat";

/**
 * Trend arrow plus a signed change. `goodDirection` decouples movement from
 * judgement: resting heart rate going down is good, net worth going down is not.
 */
export function TrendIndicator({
  direction,
  children,
  goodDirection = "up",
  className,
}: {
  direction: TrendDirection;
  children: ReactNode;
  goodDirection?: "up" | "down" | "neutral";
  className?: string;
}) {
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  const tone =
    direction === "flat" || goodDirection === "neutral"
      ? "text-ink-muted"
      : direction === goodDirection
        ? "text-positive"
        : "text-critical";

  return (
    <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium", tone, className)}>
      <span aria-hidden>{arrow}</span>
      <span>{children}</span>
    </span>
  );
}

/* -------------------------------------------------------------- stat tile */

export function StatTile({
  label,
  value,
  delta,
  sub,
  chart,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  sub?: ReactNode;
  chart?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[13px] text-ink-muted">{label}</p>
      {/* Proportional figures: tabular-nums makes large standalone numbers look loose. */}
      <p className="mt-1 text-xl font-semibold tracking-tight text-ink">{value}</p>
      {delta ? <div className="mt-1">{delta}</div> : null}
      {sub ? <p className="mt-1 text-[13px] text-ink-subtle">{sub}</p> : null}
      {chart ? <div className="mt-2">{chart}</div> : null}
    </div>
  );
}

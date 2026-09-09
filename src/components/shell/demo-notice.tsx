import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sample data is never allowed to look like the user's real life. */
export function DemoNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-border-strong bg-surface-sunken px-3.5 py-2.5 text-[13px]",
        className,
      )}
    >
      <FlaskConical className="size-4 shrink-0 text-ink-subtle" />
      <span className="text-ink-muted">
        <span className="font-medium text-ink">This is sample data.</span> Every demo record is
        labelled, and none of it is yours.
      </span>
      <Link href="/settings" className="ml-auto shrink-0 font-medium text-accent hover:underline">
        Clear it
      </Link>
    </div>
  );
}

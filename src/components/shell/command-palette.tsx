"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Loader2, Search } from "lucide-react";
import { ALL_NAV_ITEMS, NOTIFICATIONS_ITEM } from "@/lib/navigation";
import { searchAction } from "@/lib/actions/search";
import { searchTypeLabel, type SearchHit } from "@/lib/domain/search-types";
import { Overlay } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

type Command = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({
  onClose,
  onOpenCapture,
}: {
  onClose: () => void;
  onOpenCapture: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searching, startSearch] = useTransition();

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const commands: Command[] = [
    { id: "capture", label: "Quick capture", hint: "⌘K", run: () => { onClose(); onOpenCapture(); } },
    { id: "ask", label: "Ask Chief of Staff", run: () => go("/chief-of-staff") },
    { id: "new-task", label: "New task", run: () => go("/tasks?new=1") },
    { id: "new-project", label: "New project", run: () => go("/projects?new=1") },
    { id: "new-goal", label: "New goal", run: () => go("/goals?new=1") },
    { id: "new-note", label: "New note", run: () => go("/notes?new=1") },
    { id: "journal", label: "Write today's journal", run: () => go("/journal") },
    { id: "review-week", label: "Review my week", run: () => go("/reviews?generate=weekly") },
    ...[...ALL_NAV_ITEMS, NOTIFICATIONS_ITEM].map((item) => ({
      id: `nav-${item.href}`,
      label: `Open ${item.label}`,
      run: () => go(item.href),
    })),
  ];

  const filteredCommands = query.trim()
    ? commands.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 5)
    : commands.slice(0, 8);

  const rows: (
    | { kind: "command"; command: Command }
    | { kind: "hit"; hit: SearchHit }
  )[] = [
    ...filteredCommands.map((command) => ({ kind: "command" as const, command })),
    ...hits.map((hit) => ({ kind: "hit" as const, hit })),
  ];

  // Focus only; this component is mounted fresh each time it opens.
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(id);
  }, []);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = setTimeout(() => {
      startSearch(async () => setHits(await searchAction(q)));
    }, 160);
    return () => clearTimeout(id);
  }, [query]);


  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (!row) return;
      if (row.kind === "command") row.command.run();
      else go(row.hit.href);
    }
  }

  return (
    <Overlay open onClose={onClose} labelledBy="palette-title">
      <h2 id="palette-title" className="sr-only">
        Search and commands
      </h2>

      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Search className="size-4 shrink-0 text-ink-subtle" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setActive(0);
            if (next.trim().length < 2) setHits([]);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search everything, or type a command…"
          className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-subtle focus:outline-none"
          aria-label="Search"
        />
        {searching ? <Loader2 className="size-4 animate-spin text-ink-subtle" /> : null}
      </div>

      <div className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
        {rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-ink-subtle">
            {query.trim().length >= 2 ? `Nothing matches "${query.trim()}".` : "Start typing."}
          </p>
        ) : (
          <ul>
            {rows.map((row, index) => {
              const isActive = index === active;
              const key = row.kind === "command" ? row.command.id : `${row.hit.type}-${row.hit.id}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => (row.kind === "command" ? row.command.run() : go(row.hit.href))}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      isActive ? "bg-surface-sunken text-ink" : "text-ink-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {row.kind === "command" ? row.command.label : row.hit.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-subtle">
                      {row.kind === "command"
                        ? row.command.hint
                        : searchTypeLabel(row.hit.type)}
                    </span>
                    {isActive ? <CornerDownLeft className="size-3.5 shrink-0 text-ink-subtle" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Overlay>
  );
}

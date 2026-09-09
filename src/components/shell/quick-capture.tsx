"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles } from "lucide-react";
import { CONFIRM_THRESHOLD, parseCapture, type CaptureType } from "@/lib/capture/parse";
import { commitCapture } from "@/lib/actions/capture";
import type { PaletteArea, PaletteProject } from "@/lib/domain/search-types";
import { Overlay } from "@/components/ui/overlay";
import { Button, Select } from "@/components/ui/primitives";
import { cn, formatDate, formatTime } from "@/lib/utils";

const TYPE_LABEL: Record<CaptureType, string> = {
  task: "Task",
  event: "Event",
  note: "Note",
  idea: "Idea",
  journal: "Journal",
  goal: "Goal",
  project: "Project",
};

const EXAMPLES = [
  "Call John tomorrow",
  "Workout at 6",
  "Idea: start a podcast",
  "Journal: today was productive",
];

export function QuickCapture({
  open,
  onClose,
  projects,
  lifeAreas,
}: {
  open: boolean;
  onClose: () => void;
  projects: PaletteProject[];
  lifeAreas: PaletteArea[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [override, setOverride] = useState<CaptureType | null>(null);
  const [projectId, setProjectId] = useState("");
  const [lifeAreaId, setLifeAreaId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Parsing is synchronous and local, so the reading updates as you type even
  // with no network and no API key.
  const parsed = useMemo(() => parseCapture(text), [text]);
  const type = override ?? parsed.type;
  const uncertain = parsed.confidence < CONFIRM_THRESHOLD && text.trim().length > 0;

  useEffect(() => {
    if (!open) return;
    setText("");
    setOverride(null);
    setProjectId("");
    setLifeAreaId("");
    setError(null);
    setDone(null);
    const id = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(id);
  }, [open]);

  function submit() {
    if (!text.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await commitCapture({
        type,
        title: parsed.title || text.trim(),
        body: parsed.body,
        dueDate: parsed.dueDate?.toISOString(),
        startsAt: parsed.startsAt?.toISOString(),
        endsAt: parsed.endsAt?.toISOString(),
        estimatedMinutes: parsed.estimatedMinutes,
        priority: parsed.priority,
        projectId,
        lifeAreaId,
      });

      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(result.created?.label ?? "Saved");
      router.refresh();
      // Leave the confirmation on screen briefly so the write is visibly real.
      setTimeout(() => {
        setDone(null);
        onClose();
      }, 700);
    });
  }

  const when =
    parsed.startsAt
      ? `${formatDate(parsed.startsAt)} at ${formatTime(parsed.startsAt)}`
      : parsed.dueDate
        ? `Due ${formatDate(parsed.dueDate)}`
        : null;

  return (
    <Overlay open={open} onClose={onClose} labelledBy="quick-capture-title" className="max-w-lg">
      <div className="p-4">
        <h2 id="quick-capture-title" className="sr-only">
          Quick capture
        </h2>

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOverride(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Capture anything…"
          className="w-full resize-none bg-transparent text-[15px] text-ink placeholder:text-ink-subtle focus:outline-none"
        />

        {text.trim() ? (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
                Saving as
              </span>
              {(uncertain
                ? ([type, ...parsed.alternatives.filter((a) => a !== type)] as CaptureType[])
                : [type]
              ).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setOverride(option)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[12px] font-medium transition-colors",
                    option === type
                      ? "border-transparent bg-accent-soft text-accent"
                      : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
                  )}
                >
                  {TYPE_LABEL[option]}
                </button>
              ))}
              {when ? <span className="text-[12px] text-ink-muted">· {when}</span> : null}
              {parsed.estimatedMinutes ? (
                <span className="text-[12px] text-ink-muted">· {parsed.estimatedMinutes}m</span>
              ) : null}
            </div>

            {uncertain ? (
              <p className="flex items-start gap-1.5 text-[12px] text-ink-subtle">
                <Sparkles className="mt-px size-3.5 shrink-0" />
                {parsed.explanation.at(-1)} Pick the right one above if this is wrong.
              </p>
            ) : null}

            {type === "task" || type === "note" || type === "idea" ? (
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label="Project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="h-8 py-0 text-[13px]"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Life area"
                  value={lifeAreaId}
                  onChange={(e) => setLifeAreaId(e.target.value)}
                  className="h-8 py-0 text-[13px]"
                >
                  <option value="">No life area</option>
                  {lifeAreas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">Try</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    onClick={() => setText(example)}
                    className="rounded-md border border-border px-2 py-1 text-[12px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-critical">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink-subtle">
            <kbd className="rounded border border-border px-1">Enter</kbd> to save
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!text.trim() || pending || Boolean(done)}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {done ? <Check className="size-3.5" /> : null}
            {done ?? (pending ? "Saving…" : "Save")}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}

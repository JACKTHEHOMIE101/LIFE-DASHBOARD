"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { BookOpen, Check, Loader2, Plus, Search, Trash2 } from "lucide-react";
import type { Note } from "@/db/schema";
import type { PaletteArea, PaletteProject } from "@/lib/domain/search-types";
import { deleteNote, saveNote, type NoteState } from "@/lib/actions/notes";
import { Overlay } from "@/components/ui/overlay";
import {
  Badge, Button, Card, DemoBadge, EmptyState, Input, Label, Select, Textarea,
} from "@/components/ui/primitives";
import { cn, formatDate, titleCase } from "@/lib/utils";

const TYPES = ["note", "idea", "meeting", "bookmark", "document"] as const;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      {label}
    </Button>
  );
}

function NoteForm({
  open,
  onClose,
  note,
  projects,
  lifeAreas,
}: {
  open: boolean;
  onClose: () => void;
  note?: Note | null;
  projects: PaletteProject[];
  lifeAreas: PaletteArea[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<NoteState, FormData>(saveNote, {});

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Overlay open={open} onClose={onClose} labelledBy="note-form-title" align="center" className="max-w-2xl">
      <form action={formAction} className="max-h-[80vh] overflow-y-auto p-5">
        <h2 id="note-form-title" className="mb-4 text-base font-semibold text-ink">
          {note ? "Edit note" : "New note"}
        </h2>
        {note ? <input type="hidden" name="id" value={note.id} /> : null}

        <div className="space-y-3.5">
          <div>
            <Label htmlFor="n-title">Title</Label>
            <Input id="n-title" name="title" required autoFocus defaultValue={note?.title ?? ""} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="n-type">Type</Label>
              <Select id="n-type" name="type" defaultValue={note?.type ?? "note"}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="n-tags">Tags</Label>
              <Input
                id="n-tags"
                name="tags"
                defaultValue={(note?.tags ?? []).join(", ")}
                placeholder="Comma separated"
              />
            </div>
            <div>
              <Label htmlFor="n-project">Project</Label>
              <Select id="n-project" name="projectId" defaultValue={note?.projectId ?? ""}>
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="n-area">Life area</Label>
              <Select id="n-area" name="lifeAreaId" defaultValue={note?.lifeAreaId ?? ""}>
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
            <Label htmlFor="n-url">Link</Label>
            <Input id="n-url" name="url" type="url" defaultValue={note?.url ?? ""} placeholder="https://" />
          </div>

          <div>
            <Label htmlFor="n-body">Content</Label>
            <Textarea id="n-body" name="body" rows={10} defaultValue={note?.body ?? ""} />
          </div>
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
          <Submit label={note ? "Save" : "Create note"} />
        </div>
      </form>
    </Overlay>
  );
}

export function NotesView({
  notes,
  selected,
  query,
  type,
  projects,
  lifeAreas,
  openNew,
}: {
  notes: Note[];
  selected: Note | null;
  query: string;
  type: string;
  projects: PaletteProject[];
  lifeAreas: PaletteArea[];
  openNew?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [formOpen, setFormOpen] = useState(Boolean(openNew));
  const [editing, setEditing] = useState<Note | null>(null);
  const [, startTransition] = useTransition();

  function push(next: { q?: string; type?: string; note?: string }) {
    const params = new URLSearchParams();
    const q = next.q ?? search;
    const t = next.type ?? type;
    if (q) params.set("q", q);
    if (t) params.set("type", t);
    if (next.note) params.set("note", next.note);
    router.push(`/notes?${params.toString()}`);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-52 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            push({ q: search });
          }}
        >
          <Search className="absolute top-2.5 left-2.5 size-3.5 text-ink-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
            className="h-9 py-0 pl-8 text-[13px]"
          />
        </form>

        <Select
          value={type}
          onChange={(e) => push({ type: e.target.value })}
          aria-label="Filter by type"
          className="h-9 w-auto py-0 text-[13px]"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>

        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          New note
        </Button>
      </div>

      {notes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title={query ? "Nothing matches" : "No notes yet"}
            description={
              query
                ? "Try a different word, or clear the search."
                : "Meeting notes, ideas, bookmarks and reference material all live here."
            }
            action={
              !query ? (
                <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                  Write your first note
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card className="max-h-[36rem] overflow-y-auto">
            <ul className="divide-y divide-border">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => push({ note: note.id })}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-surface-sunken",
                      selected?.id === note.id && "bg-surface-sunken",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                        {note.title}
                      </span>
                      {note.isDemo ? <DemoBadge /> : null}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-subtle">
                      {note.body.slice(0, 140) || "Empty"}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-subtle">
                      {titleCase(note.type)} · {formatDate(note.updatedAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected ? (
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight text-ink">{selected.title}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{titleCase(selected.type)}</Badge>
                    {selected.tags.map((tag) => (
                      <Badge key={tag} tone="accent">
                        {tag}
                      </Badge>
                    ))}
                    <span className="text-[12px] text-ink-subtle">
                      Updated {formatDate(selected.updatedAt)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(selected);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Delete ${selected.title}`}
                    onClick={() =>
                      startTransition(async () => {
                        await deleteNote(selected.id);
                        router.push("/notes");
                        router.refresh();
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {selected.url ? (
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-3 inline-block text-[13px] text-accent hover:underline"
                >
                  {selected.url}
                </a>
              ) : null}

              <div className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-muted">
                {selected.body || "This note is empty."}
              </div>
            </Card>
          ) : null}
        </div>
      )}

      <NoteForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        note={editing}
        projects={projects}
        lifeAreas={lifeAreas}
      />
    </>
  );
}

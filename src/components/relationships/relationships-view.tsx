"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Cake, Loader2, MessageCircle, Pencil, Plus, Users } from "lucide-react";
import type { PersonSummary } from "@/lib/domain/relationships";
import {
  createReachOutTask, logInteraction, savePerson, type PersonState,
} from "@/lib/actions/relationships";
import { Overlay } from "@/components/ui/overlay";
import {
  Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Input, Label, Select, Textarea,
} from "@/components/ui/primitives";
import { cn, isoDate, pluralise } from "@/lib/utils";

const IMPORTANCE_LABEL: Record<number, string> = {
  1: "Inner circle",
  2: "Close",
  3: "Regular",
  4: "Occasional",
  5: "Acquaintance",
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

function PersonForm({
  open,
  onClose,
  person,
}: {
  open: boolean;
  onClose: () => void;
  person?: PersonSummary | null;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<PersonState, FormData>(savePerson, {});

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Overlay open={open} onClose={onClose} labelledBy="person-form-title" align="center">
      <form action={formAction} className="max-h-[80vh] overflow-y-auto p-5">
        <h2 id="person-form-title" className="mb-4 text-base font-semibold text-ink">
          {person ? `Edit ${person.name}` : "Add someone"}
        </h2>
        {person ? <input type="hidden" name="id" value={person.id} /> : null}

        <div className="space-y-3.5">
          <div>
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" name="name" required autoFocus defaultValue={person?.name ?? ""} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-rel">Relationship</Label>
              <Input
                id="p-rel"
                name="relationshipType"
                defaultValue={person?.relationshipType ?? "friend"}
                placeholder="friend, family, colleague"
              />
            </div>
            <div>
              <Label htmlFor="p-imp">Importance</Label>
              <Select id="p-imp" name="importance" defaultValue={String(person?.importance ?? 3)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {IMPORTANCE_LABEL[n]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="p-cadence">Stay in touch every (days)</Label>
              <Input
                id="p-cadence"
                name="cadenceDays"
                type="number"
                min={1}
                max={730}
                defaultValue={person?.cadenceDays ?? ""}
                placeholder="Leave blank to never be nudged"
              />
            </div>
            <div>
              <Label htmlFor="p-email">Email</Label>
              <Input id="p-email" name="email" type="email" defaultValue={person?.email ?? ""} />
            </div>
            <div>
              <Label htmlFor="p-bday">Birthday</Label>
              <Input
                id="p-bday"
                name="birthday"
                type="date"
                defaultValue={person?.birthday ? isoDate(person.birthday) : ""}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="p-notes">Notes</Label>
            <Textarea id="p-notes" name="notes" rows={3} defaultValue={person?.notes ?? ""} />
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
          <Submit label={person ? "Save" : "Add person"} />
        </div>
      </form>
    </Overlay>
  );
}

function PersonRow({ person, onEdit }: { person: PersonSummary; onEdit: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <li className={cn("px-5 py-3", pending && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{person.name}</span>
            {person.isDemo ? <DemoBadge /> : null}
            {person.isOverdue ? <Badge tone="caution">Past your cadence</Badge> : null}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-subtle">
            {person.relationshipType} · {IMPORTANCE_LABEL[person.importance]}
            {person.daysSinceContact !== null
              ? ` · last contact ${person.daysSinceContact === 0 ? "today" : `${pluralise(person.daysSinceContact, "day")} ago`}`
              : " · no contact recorded"}
            {person.cadenceDays ? ` · every ${person.cadenceDays} days` : " · no cadence set"}
          </p>
          {person.notes ? (
            <p className="mt-1 line-clamp-2 text-[12px] text-ink-muted">{person.notes}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={() => run(() => logInteraction(person.id, "message"))}>
            <MessageCircle className="size-3.5" />
            Log contact
          </Button>
          {person.isOverdue ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(() => createReachOutTask(person.id, person.name))}
            >
              <Plus className="size-3.5" />
              Task
            </Button>
          ) : null}
          <button
            type="button"
            aria-label={`Edit ${person.name}`}
            onClick={onEdit}
            className="flex size-8 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

export function RelationshipsView({
  people,
  upcoming,
}: {
  people: PersonSummary[];
  upcoming: { id: string; name: string; daysUntilBirthday: number }[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PersonSummary | null>(null);

  const needsAttention = people.filter((p) => p.isOverdue);
  const rest = people.filter((p) => !p.isOverdue);

  const open = (person: PersonSummary | null) => {
    setEditing(person);
    setFormOpen(true);
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          {people.length} people
          {needsAttention.length > 0 ? ` · ${needsAttention.length} past cadence` : ""}
        </p>
        <Button variant="primary" size="sm" onClick={() => open(null)}>
          <Plus className="size-3.5" />
          Add someone
        </Button>
      </div>

      {people.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="size-5" />}
            title="No one added yet"
            description="Add the people you actually want to keep up with, and set how often. Nobody without a cadence is ever nudged about."
            action={
              <Button variant="primary" size="sm" onClick={() => open(null)}>
                Add your first person
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {needsAttention.length > 0 ? (
            <Card>
              <CardHeader
                title="Worth a message"
                description="Past the cadence you set. A suggestion, not a verdict."
              />
              <ul className="divide-y divide-border border-t border-border">
                {needsAttention.map((person) => (
                  <PersonRow key={person.id} person={person} onEdit={() => open(person)} />
                ))}
              </ul>
            </Card>
          ) : null}

          {upcoming.length > 0 ? (
            <Card>
              <CardHeader title="Coming up" />
              <ul className="divide-y divide-border border-t border-border px-5">
                {upcoming.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-2.5 text-sm">
                    <Cake className="size-3.5 text-ink-subtle" />
                    <span className="text-ink">{p.name}</span>
                    <span className="ml-auto text-[12px] text-ink-subtle">
                      {p.daysUntilBirthday === 0 ? "Today" : `in ${pluralise(p.daysUntilBirthday, "day")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Everyone else" />
            <ul className="divide-y divide-border border-t border-border">
              {rest.map((person) => (
                <PersonRow key={person.id} person={person} onEdit={() => open(person)} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      <PersonForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        person={editing}
      />
    </>
  );
}

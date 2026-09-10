"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { createProject, updateProject, type ProjectState } from "@/lib/actions/projects";
import type { PaletteArea } from "@/lib/domain/search-types";
import type { Project } from "@/db/schema";
import { Overlay } from "@/components/ui/overlay";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { isoDate } from "@/lib/utils";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function ProjectForm({
  open,
  onClose,
  lifeAreas,
  goals,
  project,
  extraGoalIds = [],
}: {
  open: boolean;
  onClose: () => void;
  lifeAreas: PaletteArea[];
  goals: { id: string; title: string }[];
  project?: Project | null;
  /** Goal ids this project already also serves. */
  extraGoalIds?: string[];
}) {
  const router = useRouter();
  const editing = Boolean(project);
  const [state, formAction] = useActionState<ProjectState, FormData>(
    editing ? updateProject : createProject,
    {},
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Overlay open={open} onClose={onClose} labelledBy="project-form-title" align="center">
      <form action={formAction} className="p-5">
        <h2 id="project-form-title" className="mb-4 text-base font-semibold text-ink">
          {editing ? "Edit project" : "New project"}
        </h2>
        {project ? <input type="hidden" name="id" value={project.id} /> : null}

        <div className="space-y-3.5">
          <div>
            <Label htmlFor="p-title">Title</Label>
            <Input id="p-title" name="title" required autoFocus defaultValue={project?.title ?? ""} />
          </div>

          <div>
            <Label htmlFor="p-objective">Objective</Label>
            <Input
              id="p-objective"
              name="objective"
              defaultValue={project?.objective ?? ""}
              placeholder="What does done look like?"
            />
          </div>

          <div>
            <Label htmlFor="p-description">Description</Label>
            <Textarea
              id="p-description"
              name="description"
              rows={2}
              className="min-h-16"
              defaultValue={project?.description ?? ""}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-status">Status</Label>
              <Select id="p-status" name="status" defaultValue={project?.status ?? "active"}>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-deadline">Deadline</Label>
              <Input
                id="p-deadline"
                name="deadline"
                type="date"
                defaultValue={project?.deadline ? isoDate(project.deadline) : ""}
              />
            </div>
            <div>
              <Label htmlFor="p-area">Life area</Label>
              <Select id="p-area" name="lifeAreaId" defaultValue={project?.lifeAreaId ?? ""}>
                <option value="">None</option>
                {lifeAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="p-goal">Primary goal</Label>
              <Select id="p-goal" name="goalId" defaultValue={project?.goalId ?? ""}>
                <option value="">None</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {goals.length > 1 ? (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-[12px] text-ink-muted">Also serves</legend>
              <p className="mb-2 text-[11px] text-ink-subtle">
                Real work rarely advances exactly one goal. Anything ticked here counts this
                project toward that goal too.
              </p>
              <div className="space-y-1.5">
                {goals.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-[13px] text-ink-muted">
                    <input
                      type="checkbox"
                      name="extraGoalIds"
                      value={g.id}
                      defaultChecked={extraGoalIds.includes(g.id)}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    {g.title}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
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
          <Submit label={editing ? "Save changes" : "Create project"} />
        </div>
      </form>
    </Overlay>
  );
}

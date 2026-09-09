"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { createTask, updateTask, type ActionState } from "@/lib/actions/tasks";
import type { PaletteArea, PaletteProject } from "@/lib/domain/search-types";
import type { Task } from "@/db/schema";
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

export function TaskForm({
  open,
  onClose,
  projects,
  lifeAreas,
  task,
  defaultProjectId,
}: {
  open: boolean;
  onClose: () => void;
  projects: PaletteProject[];
  lifeAreas: PaletteArea[];
  task?: Task | null;
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const editing = Boolean(task);
  const [state, formAction] = useActionState<ActionState, FormData>(
    editing ? updateTask : createTask,
    {},
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
    // onClose is stable enough here; refiring on every render would close the
    // sheet the moment it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Overlay open={open} onClose={onClose} labelledBy="task-form-title" align="center">
      <form action={formAction} className="p-5">
        <h2 id="task-form-title" className="mb-4 text-base font-semibold text-ink">
          {editing ? "Edit task" : "New task"}
        </h2>

        {task ? <input type="hidden" name="id" value={task.id} /> : null}

        <div className="space-y-3.5">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
              autoFocus
              maxLength={200}
              defaultValue={task?.title ?? ""}
              placeholder="What needs doing?"
            />
          </div>

          <div>
            <Label htmlFor="description">Notes</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={task?.description ?? ""}
              placeholder="Optional detail"
              className="min-h-16"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select id="priority" name="priority" defaultValue={task?.priority ?? "should"}>
                <option value="must">Must do</option>
                <option value="should">Should do</option>
                <option value="could">Could do</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="energy">Energy</Label>
              <Select id="energy" name="energy" defaultValue={task?.energy ?? "medium"}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="dueDate">Due date</Label>
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                defaultValue={task?.dueDate ? isoDate(task.dueDate) : ""}
              />
            </div>
            <div>
              <Label htmlFor="estimatedMinutes">Estimate (min)</Label>
              <Input
                id="estimatedMinutes"
                name="estimatedMinutes"
                type="number"
                min={0}
                max={1440}
                step={5}
                defaultValue={task?.estimatedMinutes ?? ""}
                placeholder="30"
              />
            </div>
            <div>
              <Label htmlFor="projectId">Project</Label>
              <Select
                id="projectId"
                name="projectId"
                defaultValue={task?.projectId ?? defaultProjectId ?? ""}
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lifeAreaId">Life area</Label>
              <Select id="lifeAreaId" name="lifeAreaId" defaultValue={task?.lifeAreaId ?? ""}>
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
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              name="tags"
              defaultValue={(task?.tags ?? []).join(", ")}
              placeholder="Comma separated"
            />
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
          <Submit label={editing ? "Save changes" : "Add task"} />
        </div>
      </form>
    </Overlay>
  );
}

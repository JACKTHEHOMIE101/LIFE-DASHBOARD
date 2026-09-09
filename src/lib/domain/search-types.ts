/**
 * Shapes and labels shared by the server-side search implementation and the
 * client-side command palette. Kept free of any database import so the palette
 * can use it without dragging `server-only` into the browser bundle.
 */

export type SearchHitType =
  | "task" | "project" | "goal" | "person"
  | "note" | "journal" | "event" | "transaction";

export type SearchHit = {
  id: string;
  type: SearchHitType;
  title: string;
  subtitle?: string | null;
  href: string;
};

const TYPE_LABEL: Record<SearchHitType, string> = {
  task: "Task",
  project: "Project",
  goal: "Goal",
  person: "Person",
  note: "Note",
  journal: "Journal",
  event: "Event",
  transaction: "Transaction",
};

export function searchTypeLabel(type: SearchHitType) {
  return TYPE_LABEL[type];
}

export type PaletteProject = { id: string; title: string };
export type PaletteArea = { id: string; name: string; color: string };

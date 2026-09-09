import { integer, text } from "drizzle-orm/sqlite-core";

/** Every row gets a stable UUID primary key generated in the app layer. */
export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/** Soft deletion. Rows with a non-null value are hidden from all reads. */
export const deletedAt = () => integer("deleted_at", { mode: "timestamp_ms" });

export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
};

/**
 * Data ownership (requirement 28). Every record must make it possible to tell
 * apart what the user wrote, what an integration imported, and what the AI
 * produced. AI-generated records are never allowed to overwrite `user` rows.
 */
export type Origin = "user" | "imported" | "ai";

export const ownership = {
  origin: text("origin").$type<Origin>().notNull().default("user"),
  /** Demo data is orthogonal to origin: it is always visibly labelled in the UI. */
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
};

/**
 * Provenance for anything that can arrive from an external provider.
 * `provider` + `externalId` is the natural key used for idempotent upserts,
 * which is also what stops duplicate notifications for the same synced object.
 */
export const provenance = {
  provider: text("provider"),
  externalId: text("external_id"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  sourceMeta: text("source_meta", { mode: "json" }).$type<Record<string, unknown>>(),
};

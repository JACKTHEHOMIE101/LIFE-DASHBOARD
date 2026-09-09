import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, ownership, provenance, timestamps } from "./columns";

/* ---------------------------------------------------------------- identity */

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  ...timestamps,
});

export const userSettings = sqliteTable("user_settings", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  theme: text("theme").$type<"light" | "dark" | "system">().notNull().default("system"),
  weekStartsOn: integer("week_starts_on").notNull().default(1),
  quietHoursEnabled: integer("quiet_hours_enabled", { mode: "boolean" }).notNull().default(true),
  quietHoursStart: text("quiet_hours_start").notNull().default("22:00"),
  quietHoursEnd: text("quiet_hours_end").notNull().default("07:00"),
  criticalBypassesQuietHours: integer("critical_bypasses_quiet_hours", { mode: "boolean" }).notNull().default(true),
  morningBriefingEnabled: integer("morning_briefing_enabled", { mode: "boolean" }).notNull().default(true),
  morningBriefingTime: text("morning_briefing_time").notNull().default("07:30"),
  eveningBriefingEnabled: integer("evening_briefing_enabled", { mode: "boolean" }).notNull().default(false),
  eveningBriefingTime: text("evening_briefing_time").notNull().default("20:30"),
  demoDataPresent: integer("demo_data_present", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

/** Registered browsers and phones. Push subscriptions live here so each can be revoked on its own. */
export const devices = sqliteTable("devices", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  platform: text("platform"),
  userAgent: text("user_agent"),
  pushEndpoint: text("push_endpoint"),
  pushP256dh: text("push_p256dh"),
  pushAuth: text("push_auth"),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" }).notNull().default(false),
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  ...timestamps,
}, (t) => [
  index("devices_user_idx").on(t.userId),
  uniqueIndex("devices_endpoint_idx").on(t.pushEndpoint),
]);

/* -------------------------------------------------------------- life areas */

export const lifeAreas = sqliteTable("life_areas", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  color: text("color").notNull().default("slate"),
  icon: text("icon").notNull().default("circle"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  ...ownership,
  ...timestamps,
}, (t) => [
  index("life_areas_user_idx").on(t.userId),
  uniqueIndex("life_areas_user_slug_idx").on(t.userId, t.slug),
]);

/* ------------------------------------------------------------------- goals */

export type GoalStatus = "active" | "paused" | "achieved" | "abandoned";

export const goals = sqliteTable("goals", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lifeAreaId: text("life_area_id").references(() => lifeAreas.id, { onDelete: "set null" }),
  /** Self-reference carries the Life Vision to Goal to sub-goal hierarchy without another table. */
  parentGoalId: text("parent_goal_id"),
  title: text("title").notNull(),
  description: text("description"),
  why: text("why"),
  status: text("status").$type<GoalStatus>().notNull().default("active"),
  targetDate: integer("target_date", { mode: "timestamp_ms" }),
  metricName: text("metric_name"),
  metricUnit: text("metric_unit"),
  startValue: real("start_value"),
  currentValue: real("current_value"),
  targetValue: real("target_value"),
  /** Fallback used only when a goal has no measurable metric. */
  manualProgress: real("manual_progress"),
  lastProgressAt: integer("last_progress_at", { mode: "timestamp_ms" }),
  ...ownership,
  ...timestamps,
}, (t) => [
  index("goals_user_idx").on(t.userId),
  index("goals_area_idx").on(t.lifeAreaId),
  index("goals_parent_idx").on(t.parentGoalId),
]);

/* ---------------------------------------------------------------- projects */

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "archived";

export const projects = sqliteTable("projects", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lifeAreaId: text("life_area_id").references(() => lifeAreas.id, { onDelete: "set null" }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  objective: text("objective"),
  status: text("status").$type<ProjectStatus>().notNull().default("active"),
  deadline: integer("deadline", { mode: "timestamp_ms" }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  /** Denormalised so stalled-project detection stays a single indexed scan. */
  lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [
  index("projects_user_idx").on(t.userId),
  index("projects_status_idx").on(t.userId, t.status),
  index("projects_activity_idx").on(t.lastActivityAt),
  uniqueIndex("projects_external_idx").on(t.provider, t.externalId),
]);

export const milestones = sqliteTable("milestones", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  sortOrder: integer("sort_order").notNull().default(0),
  ...ownership,
  ...timestamps,
}, (t) => [index("milestones_project_idx").on(t.projectId)]);

/* ------------------------------------------------------------------- tasks */

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "must" | "should" | "could";
export type EnergyLevel = "low" | "medium" | "high";

export const tasks = sqliteTable("tasks", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  lifeAreaId: text("life_area_id").references(() => lifeAreas.id, { onDelete: "set null" }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  personId: text("person_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").$type<TaskStatus>().notNull().default("todo"),
  priority: text("priority").$type<TaskPriority>().notNull().default("should"),
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }),
  estimatedMinutes: integer("estimated_minutes"),
  actualMinutes: integer("actual_minutes"),
  energy: text("energy").$type<EnergyLevel>().notNull().default("medium"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  recurrenceRule: text("recurrence_rule"),
  snoozedUntil: integer("snoozed_until", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  sortOrder: integer("sort_order").notNull().default(0),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [
  index("tasks_user_idx").on(t.userId),
  index("tasks_status_idx").on(t.userId, t.status),
  index("tasks_due_idx").on(t.userId, t.dueDate),
  index("tasks_project_idx").on(t.projectId),
  uniqueIndex("tasks_external_idx").on(t.provider, t.externalId),
]);

/* ------------------------------------------------------------------ events */

/**
 * Normalised calendar event. Provider-specific shapes are flattened into this
 * by the integration layer, so nothing downstream knows which calendar it came from.
 */
export type EventCategory =
  | "meeting" | "focus" | "health" | "personal" | "social" | "travel" | "other";

export const events = sqliteTable("events", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  calendarId: text("calendar_id"),
  calendarName: text("calendar_name"),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  category: text("category").$type<EventCategory>().notNull().default("other"),
  attendees: text("attendees", { mode: "json" }).$type<{ name?: string; email?: string }[]>().notNull().default([]),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [
  index("events_user_start_idx").on(t.userId, t.startsAt),
  uniqueIndex("events_external_idx").on(t.provider, t.externalId),
]);

/* --------------------------------------------------- people / personal CRM */

export const people = sqliteTable("people", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationshipType: text("relationship_type").notNull().default("friend"),
  /** 1 = inner circle, 5 = acquaintance. Drives the suggested contact cadence. */
  importance: integer("importance").notNull().default(3),
  email: text("email"),
  phone: text("phone"),
  birthday: integer("birthday", { mode: "timestamp_ms" }),
  notes: text("notes"),
  interests: text("interests", { mode: "json" }).$type<string[]>().notNull().default([]),
  importantDates: text("important_dates", { mode: "json" }).$type<{ label: string; date: string }[]>().notNull().default([]),
  lastInteractionAt: integer("last_interaction_at", { mode: "timestamp_ms" }),
  nextPlannedInteractionAt: integer("next_planned_interaction_at", { mode: "timestamp_ms" }),
  /** How often the user says they want to stay in touch. Null means never nudge. */
  cadenceDays: integer("cadence_days"),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [index("people_user_idx").on(t.userId)]);

export const interactions = sqliteTable("interactions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  personId: text("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("message"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  notes: text("notes"),
  eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
  ...ownership,
  ...timestamps,
}, (t) => [index("interactions_person_idx").on(t.personId, t.occurredAt)]);

/* ------------------------------------------------------------------ habits */

export type HabitFrequency = "daily" | "weekly";

export const habits = sqliteTable("habits", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lifeAreaId: text("life_area_id").references(() => lifeAreas.id, { onDelete: "set null" }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  frequency: text("frequency").$type<HabitFrequency>().notNull().default("daily"),
  /** Times per period. A daily habit with target 1 is the common case. */
  targetPerPeriod: integer("target_per_period").notNull().default(1),
  notes: text("notes"),
  color: text("color").notNull().default("slate"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...ownership,
  ...timestamps,
}, (t) => [index("habits_user_idx").on(t.userId)]);

export const habitEntries = sqliteTable("habit_entries", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  habitId: text("habit_id").notNull().references(() => habits.id, { onDelete: "cascade" }),
  /** Local calendar day as YYYY-MM-DD, so streaks never drift with timezones. */
  date: text("date").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(true),
  value: real("value"),
  notes: text("notes"),
  ...ownership,
  ...timestamps,
}, (t) => [uniqueIndex("habit_entries_unique_idx").on(t.habitId, t.date)]);

/* ----------------------------------------------------------------- journal */

export const journalEntries = sqliteTable("journal_entries", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  mood: integer("mood"),
  energy: integer("energy"),
  productivity: integer("productivity"),
  wins: text("wins"),
  challenges: text("challenges"),
  gratitude: text("gratitude"),
  notes: text("notes"),
  tomorrowPriority: text("tomorrow_priority"),
  ...ownership,
  ...timestamps,
}, (t) => [uniqueIndex("journal_user_date_idx").on(t.userId, t.date)]);

/* ------------------------------------------------------- notes / knowledge */

export type NoteType = "note" | "idea" | "meeting" | "bookmark" | "document";

export const notes = sqliteTable("notes", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  type: text("type").$type<NoteType>().notNull().default("note"),
  url: text("url"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  lifeAreaId: text("life_area_id").references(() => lifeAreas.id, { onDelete: "set null" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  personId: text("person_id").references(() => people.id, { onDelete: "set null" }),
  /** Reserved for a future embedding column so semantic search can be added without a migration of meaning. */
  embeddingModel: text("embedding_model"),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [index("notes_user_idx").on(t.userId)]);

/* ---------------------------------------------------------------- health */

/** One normalised row per metric per day, whatever provider supplied it. */
export type MetricKind =
  | "sleep_minutes" | "resting_heart_rate" | "hrv" | "steps"
  | "active_minutes" | "weight_kg" | "calories" | "recovery_score";

export const metrics = sqliteTable("metrics", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<MetricKind>().notNull(),
  date: text("date").notNull(),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [
  index("metrics_user_kind_date_idx").on(t.userId, t.kind, t.date),
  uniqueIndex("metrics_unique_idx").on(t.userId, t.kind, t.date, t.provider),
]);

/* --------------------------------------------------------------- fitness */

export const workouts = sqliteTable("workouts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("strength"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  durationMinutes: integer("duration_minutes"),
  distanceMeters: real("distance_meters"),
  calories: integer("calories"),
  avgHeartRate: integer("avg_heart_rate"),
  notes: text("notes"),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [
  index("workouts_user_idx").on(t.userId, t.startedAt),
  uniqueIndex("workouts_external_idx").on(t.provider, t.externalId),
]);

export const exercises = sqliteTable("exercises", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workoutId: text("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (t) => [index("exercises_workout_idx").on(t.workoutId)]);

export const exerciseSets = sqliteTable("exercise_sets", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
  setNumber: integer("set_number").notNull(),
  reps: integer("reps"),
  weightKg: real("weight_kg"),
  distanceMeters: real("distance_meters"),
  durationSeconds: integer("duration_seconds"),
  ...timestamps,
}, (t) => [index("exercise_sets_exercise_idx").on(t.exerciseId)]);

/* -------------------------------------------------------------- finances */

export type AccountType =
  | "checking" | "savings" | "investment" | "retirement"
  | "credit" | "loan" | "mortgage" | "asset";

export const financialAccounts = sqliteTable("financial_accounts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  institution: text("institution"),
  type: text("type").$type<AccountType>().notNull(),
  currency: text("currency").notNull().default("USD"),
  /** Minor units (cents). Liabilities are stored positive and negated by the net-worth calc. */
  balanceMinor: integer("balance_minor").notNull().default(0),
  isLiability: integer("is_liability", { mode: "boolean" }).notNull().default(false),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [
  index("financial_accounts_user_idx").on(t.userId),
  uniqueIndex("financial_accounts_external_idx").on(t.provider, t.externalId),
]);

export const transactions = sqliteTable("transactions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").references(() => financialAccounts.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  description: text("description").notNull(),
  merchant: text("merchant"),
  /** Negative is money out, positive is money in. Minor units. */
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("USD"),
  category: text("category").notNull().default("other"),
  isRecurring: integer("is_recurring", { mode: "boolean" }).notNull().default(false),
  ...ownership,
  ...provenance,
  ...timestamps,
}, (t) => [
  index("transactions_user_date_idx").on(t.userId, t.date),
  index("transactions_category_idx").on(t.userId, t.category),
  uniqueIndex("transactions_external_idx").on(t.provider, t.externalId),
]);

/* --------------------------------------------------------------- reviews */

export type ReviewType = "weekly" | "monthly";

export const reviews = sqliteTable("reviews", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<ReviewType>().notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  status: text("status").$type<"draft" | "final">().notNull().default("draft"),
  /** Deterministic facts computed from the database, never written by the model. */
  stats: text("stats", { mode: "json" }).$type<Record<string, unknown>>(),
  /** Narrative sections. Generated as a starting point, then editable by the user. */
  sections: text("sections", { mode: "json" }).$type<Record<string, string>>(),
  editedByUser: integer("edited_by_user", { mode: "boolean" }).notNull().default(false),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  ...ownership,
  ...timestamps,
}, (t) => [uniqueIndex("reviews_period_idx").on(t.userId, t.type, t.periodStart)]);

/* ---------------------------------------------------------- integrations */

export type IntegrationStatus = "disconnected" | "connected" | "error" | "syncing";

export const integrations = sqliteTable("integrations", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").$type<IntegrationStatus>().notNull().default("disconnected"),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
  /**
   * Pointer to the secret in the server-side credential store, never the secret
   * itself. Nothing in this table is safe-by-default to send to a client.
   */
  credentialRef: text("credential_ref"),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
  connectedAt: integer("connected_at", { mode: "timestamp_ms" }),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  ...timestamps,
}, (t) => [uniqueIndex("integrations_user_provider_idx").on(t.userId, t.provider)]);

export const syncRecords = sqliteTable("sync_records", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  integrationId: text("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  status: text("status").$type<"running" | "success" | "failed">().notNull().default("running"),
  mode: text("mode").$type<"full" | "incremental">().notNull().default("incremental"),
  created: integer("created").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  deleted: integer("deleted").notNull().default(0),
  /** Opaque provider cursor that makes the next sync incremental. */
  cursor: text("cursor"),
  error: text("error"),
  ...timestamps,
}, (t) => [index("sync_records_integration_idx").on(t.integrationId, t.startedAt)]);

/* -------------------------------------------------------- notifications */

export type NotificationPriority = "low" | "normal" | "high" | "critical";
export type NotificationCategory =
  | "tasks" | "calendar" | "projects" | "goals"
  | "health" | "finance" | "relationships" | "ai" | "system";
/** Reminders are user-requested, notifications are system-generated, insights are AI-derived. */
export type NotificationKind = "reminder" | "notification" | "insight";

export const notifications = sqliteTable("notifications", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<NotificationKind>().notNull().default("notification"),
  category: text("category").$type<NotificationCategory>().notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  priority: text("priority").$type<NotificationPriority>().notNull().default("normal"),
  scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
  snoozedUntil: integer("snoozed_until", { mode: "timestamp_ms" }),
  deepLink: text("deep_link"),
  actions: text("actions", { mode: "json" }).$type<{ label: string; action: string; payload?: Record<string, unknown> }[]>().notNull().default([]),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  /** Stable key that makes scheduling idempotent, so re-synced objects cannot double-notify. */
  dedupeKey: text("dedupe_key").notNull(),
  deliveredChannels: text("delivered_channels", { mode: "json" }).$type<string[]>().notNull().default([]),
  ...timestamps,
}, (t) => [
  index("notifications_user_idx").on(t.userId, t.scheduledFor),
  uniqueIndex("notifications_dedupe_idx").on(t.userId, t.dedupeKey),
]);

export const notificationPreferences = sqliteTable("notification_preferences", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: text("category").$type<NotificationCategory>().notNull(),
  channel: text("channel").$type<"inapp" | "push" | "email">().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priorityThreshold: text("priority_threshold").$type<NotificationPriority>().notNull().default("low"),
  /** Lead times in minutes, e.g. [1440, 180, 30] for a task due reminder. */
  leadMinutes: text("lead_minutes", { mode: "json" }).$type<number[]>().notNull().default([]),
  ...timestamps,
}, (t) => [uniqueIndex("notif_prefs_idx").on(t.userId, t.category, t.channel)]);

/* -------------------------------------------------------------------- AI */

export const aiConversations = sqliteTable("ai_conversations", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New conversation"),
  ...timestamps,
}, (t) => [index("ai_conversations_user_idx").on(t.userId, t.updatedAt)]);

export const aiMessages = sqliteTable("ai_messages", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  /** Which Life OS reads backed the answer, so every claim can be traced. */
  citations: text("citations", { mode: "json" }).$type<{ label: string; source: string; detail?: string }[]>().notNull().default([]),
  toolCalls: text("tool_calls", { mode: "json" }).$type<{ name: string; input: unknown }[]>().notNull().default([]),
  ...timestamps,
}, (t) => [index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt)]);

/* ------------------------------------------------------ focus and signals */

export const focusSessions = sqliteTable("focus_sessions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  label: text("label"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  plannedMinutes: integer("planned_minutes"),
  elapsedSeconds: integer("elapsed_seconds").notNull().default(0),
  status: text("status").$type<"running" | "paused" | "completed" | "abandoned">().notNull().default("running"),
  ...timestamps,
}, (t) => [index("focus_sessions_user_idx").on(t.userId, t.startedAt)]);

/** Records the user telling us an Attention signal is not worth surfacing right now. */
export const signalDismissals = sqliteTable("signal_dismissals", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  signalKey: text("signal_key").notNull(),
  dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
  snoozedUntil: integer("snoozed_until", { mode: "timestamp_ms" }),
  ...timestamps,
}, (t) => [uniqueIndex("signal_dismissals_idx").on(t.userId, t.signalKey)]);

/** How the user intends to spend their week, for intended-vs-actual time analytics. */
export const timeBudgets = sqliteTable("time_budgets", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  intendedMinutesPerWeek: integer("intended_minutes_per_week").notNull().default(0),
  ...timestamps,
}, (t) => [uniqueIndex("time_budgets_idx").on(t.userId, t.category)]);

/** Append-only trail for security-relevant and AI-initiated actions. */
export const auditLog = sqliteTable("audit_log", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actor: text("actor").$type<"user" | "ai" | "system">().notNull().default("user"),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [index("audit_log_user_idx").on(t.userId, t.createdAt)]);

/* ------------------------------------------------------------ inferred types */

export type User = typeof users.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type LifeArea = typeof lifeAreas.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type CalendarEvent = typeof events.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Interaction = typeof interactions.$inferSelect;
export type Habit = typeof habits.$inferSelect;
export type HabitEntry = typeof habitEntries.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Metric = typeof metrics.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type ExerciseSet = typeof exerciseSets.$inferSelect;
export type FinancialAccount = typeof financialAccounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type SyncRecord = typeof syncRecords.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type FocusSession = typeof focusSessions.$inferSelect;
export type SignalDismissal = typeof signalDismissals.$inferSelect;
export type TimeBudget = typeof timeBudgets.$inferSelect;

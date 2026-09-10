import type {
  EventCategory, GoalKind, GoalStatus, MetricKind, ProjectStatus, TaskPriority,
} from "@/db/schema";

/**
 * Display labels shared by server queries and client components.
 *
 * Kept in its own module with no database import so a client component can use
 * a label without pulling `server-only` into the browser bundle.
 */

export const GOAL_KIND_LABEL: Record<GoalKind, string> = {
  target: "Reach a target",
  floor: "Stay at or above",
  ceiling: "Stay at or below",
};

/** Shown under the selector so the difference is obvious when choosing. */
export const GOAL_KIND_HINT: Record<GoalKind, string> = {
  target: "A climb. Progress is measured from where you started.",
  floor: "A line to defend, like a GPA. No progress bar — you are holding it or you are not.",
  ceiling: "A limit to stay under, like a resting heart rate or a monthly spend.",
};

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Active",
  paused: "Paused",
  achieved: "Achieved",
  abandoned: "Abandoned",
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  must: "Must do",
  should: "Should do",
  could: "Could do",
};

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  meeting: "Meeting",
  focus: "Focus",
  health: "Health",
  personal: "Personal",
  social: "Social",
  travel: "Travel",
  other: "Other",
};

export const METRIC_LABEL: Record<MetricKind, string> = {
  sleep_minutes: "Sleep",
  resting_heart_rate: "Resting heart rate",
  hrv: "HRV",
  steps: "Steps",
  active_minutes: "Active minutes",
  weight_kg: "Weight",
  calories: "Calories",
  recovery_score: "Recovery",
};

/** Whether a rise in a metric is good, so trend arrows read correctly. */
export const METRIC_GOOD_DIRECTION: Record<MetricKind, "up" | "down" | "neutral"> = {
  sleep_minutes: "up",
  resting_heart_rate: "down",
  hrv: "up",
  steps: "up",
  active_minutes: "up",
  weight_kg: "neutral",
  calories: "neutral",
  recovery_score: "up",
};

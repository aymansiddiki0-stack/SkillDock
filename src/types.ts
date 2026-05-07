/** Outcome for a single requested skill. */
export type SkillResultStatus =
  | "added"
  | "already-present"
  | "no-exact-match"
  | "timed-out"
  | "selection-not-confirmed"
  | "cancelled"
  | "error";

export interface SkillResult {
  /** The skill exactly as the user saved it. */
  skill: string;
  status: SkillResultStatus;
  /** Short human-readable explanation (timeout reason, error message, …). */
  detail?: string;
}

export interface RunProgress {
  total: number;
  /** Number of skills that already produced a result. */
  completed: number;
  /** Skill currently being processed, if any. */
  current: string | null;
}

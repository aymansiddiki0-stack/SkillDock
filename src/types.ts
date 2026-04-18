/** Outcome for a single requested skill. */
export type SkillResultStatus =
  | "added"
  | "already-present"
  | "no-exact-match"
  | "error";

export interface SkillResult {
  /** The skill exactly as the user saved it. */
  skill: string;
  status: SkillResultStatus;
  /** Short human-readable explanation (timeout reason, error message, …). */
  detail?: string;
}

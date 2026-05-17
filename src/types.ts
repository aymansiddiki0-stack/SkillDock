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

export type RunOutcome = "completed" | "cancelled" | "detection-failed" | "interrupted";

export interface RunReport {
  startedAt: number;
  finishedAt: number;
  outcome: RunOutcome;
  /** Present when outcome is "detection-failed". */
  detail?: string;
  results: SkillResult[];
}

export type RunPhase = "idle" | "running" | "finished";

export interface RunStatus {
  phase: RunPhase;
  progress?: RunProgress;
  report?: RunReport;
}

export type PopupMessage =
  | { type: "skilldock:start"; skills: string[] }
  | { type: "skilldock:cancel" }
  | { type: "skilldock:status" }
  | { type: "skilldock:pick-field" };

export type StartResponse =
  | { ok: true }
  | { ok: false; reason: "already-running" | "detection-failed"; detail?: string };

export type PickFieldResponse = { ok: boolean; detail?: string };

export interface StatusResponse {
  status: RunStatus;
}

import { CancelledError, TimeoutError, waitFor, delay } from "./wait";
import { isExactMatch } from "./normalization";
import { clearQuery, clickOption, dismissDropdown, pressEnter, typeQuery } from "./workday/interact-with-combobox";
import { optionText, readDropdownState } from "./workday/locate-dropdown";
import { isSkillSelected, selectionConfirmed, snapshotSelection } from "./workday/verify-selection";
import type { RunProgress, SkillResult } from "./types";

export interface EngineOptions {
  field: HTMLInputElement;
  skills: string[];
  signal: AbortSignal;
  onProgress: (progress: RunProgress) => void;
  timing?: Partial<EngineTiming>;
}

export interface EngineTiming {
  /** Max wait for suggestions after entering a query. */
  optionsTimeoutMs: number;
  /** Max wait for the selected-chip confirmation after clicking an option. */
  verifyTimeoutMs: number;
  /** Small settle delay between skills. */
  betweenSkillsMs: number;
}

const DEFAULT_TIMING: EngineTiming = {
  optionsTimeoutMs: 8000,
  verifyTimeoutMs: 4000,
  betweenSkillsMs: 250,
};

export async function runFillEngine(opts: EngineOptions): Promise<SkillResult[]> {
  const timing: EngineTiming = { ...DEFAULT_TIMING, ...opts.timing };
  const { field, skills, signal, onProgress } = opts;
  const results: SkillResult[] = [];

  const report = (current: string | null) =>
    onProgress({ total: skills.length, completed: results.length, current });

  for (const skill of skills) {
    if (signal.aborted) {
      results.push({ skill, status: "cancelled" });
      continue;
    }
    report(skill);
    try {
      results.push(await processSkill(field, skill, timing, signal));
    } catch (err) {
      if (err instanceof CancelledError) {
        results.push({ skill, status: "cancelled" });
      } else {
        results.push({ skill, status: "error", detail: errorMessage(err) });
      }
    }
    report(null);
    if (!signal.aborted) {
      try {
        await delay(timing.betweenSkillsMs, signal);
      } catch {
        /* cancelled during settle delay — remaining skills report cancelled */
      }
    }
  }
  return results;
}

async function processSkill(
  field: HTMLInputElement,
  skill: string,
  timing: EngineTiming,
  signal: AbortSignal,
): Promise<SkillResult> {
  if (isSkillSelected(field, skill)) {
    return { skill, status: "already-present" };
  }

  const typed = await typeQuery(field, skill, signal);
  if (!typed) {
    return { skill, status: "error", detail: "Workday rejected the entered query text" };
  }

  pressEnter(field);

  let state;
  try {
    state = await waitFor(() => readDropdownState(field), {
      description: `suggestions for "${skill}"`,
      timeoutMs: timing.optionsTimeoutMs,
      signal,
    });
  } catch (err) {
    if (err instanceof TimeoutError) {
      clearQuery(field);
      dismissDropdown(field);
      return { skill, status: "timed-out", detail: err.message };
    }
    throw err;
  }

  const match = state.options.find((opt) => isExactMatch(optionText(opt), skill));
  if (!match) {
    clearQuery(field);
    dismissDropdown(field);
    return { skill, status: "no-exact-match" };
  }

  const before = snapshotSelection(field);
  clickOption(match);

  try {
    await waitFor(() => (selectionConfirmed(field, before, skill) ? true : null), {
      description: `confirmation that "${skill}" was added`,
      timeoutMs: timing.verifyTimeoutMs,
      signal,
    });
  } catch (err) {
    if (err instanceof TimeoutError) {
      return {
        skill,
        status: "selection-not-confirmed",
        detail: "Selected an exact match but Workday never showed it as selected",
      };
    }
    throw err;
  }

  clearQuery(field);
  dismissDropdown(field);
  return { skill, status: "added" };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

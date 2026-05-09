import { CancelledError, TimeoutError, waitFor, delay } from "./wait";
import { isExactMatch } from "./normalization";
import { locateSkillsField } from "./workday/locate-skills-field";
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

const MAX_ATTEMPTS_PER_SKILL = 2;

const DEFAULT_TIMING: EngineTiming = {
  optionsTimeoutMs: 8000,
  verifyTimeoutMs: 4000,
  betweenSkillsMs: 250,
};

export async function runFillEngine(opts: EngineOptions): Promise<SkillResult[]> {
  const timing: EngineTiming = { ...DEFAULT_TIMING, ...opts.timing };
  const { skills, signal, onProgress } = opts;

  let field = opts.field;
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
      field = await reacquireField(field, signal);
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

/** Re-run the locator when the input was replaced by a rerender. */
async function reacquireField(field: HTMLInputElement, signal: AbortSignal): Promise<HTMLInputElement> {
  if (field.isConnected) return field;
  const found = await waitFor(
    () => {
      const res = locateSkillsField(field.ownerDocument);
      return res.kind === "found" && res.field instanceof HTMLInputElement ? res.field : null;
    },
    { description: "the Skills field to reappear after a rerender", timeoutMs: 5000, signal },
  );
  return found;
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

  let lastFailure: SkillResult | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_SKILL; attempt++) {
    if (!field.isConnected) field = await reacquireField(field, signal);

    const typed = await typeQuery(field, skill, signal);
    if (!typed) {
      lastFailure = { skill, status: "error", detail: "Workday rejected the entered query text" };
      continue;
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
        lastFailure = { skill, status: "timed-out", detail: err.message };
        continue;
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
    const confirmed = await confirmSelection(field, before, skill, timing.verifyTimeoutMs, signal);

    if (confirmed) {
      if (field.isConnected) {
        clearQuery(field);
        dismissDropdown(field);
      }
      return { skill, status: "added" };
    }

    // Last chance: the confirmation signals may simply have been missed —
    // most often because a rerender swapped the input out from under us.
    if (!field.isConnected) field = await reacquireField(field, signal);
    if (isSkillSelected(field, skill)) return { skill, status: "added" };
    clearQuery(field);
    dismissDropdown(field);
    lastFailure = { skill, status: "selection-not-confirmed", detail: "Selected an exact match but Workday never showed it as selected" };
  }

  return lastFailure ?? { skill, status: "error", detail: "Exhausted retries" };
}

/**
 * Wait until the skill shows as selected. False on timeout.
 */
async function confirmSelection(
  field: HTMLInputElement,
  before: ReturnType<typeof snapshotSelection>,
  skill: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await waitFor(() => (selectionConfirmed(field, before, skill) ? true : null), {
      description: `confirmation that "${skill}" was added`,
      timeoutMs,
      signal,
    });
    return true;
  } catch (err) {
    if (err instanceof TimeoutError) return false;
    throw err;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

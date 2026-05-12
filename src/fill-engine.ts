import { CancelledError, TimeoutError, waitFor, delay } from "./wait";
import { isExactMatch } from "./normalization";
import { locateSkillsField } from "./workday/locate-skills-field";
import { clearQuery, clickOption, dismissDropdown, pressEnter, typeQuery } from "./workday/interact-with-combobox";
import { isOptionSelected, optionText, readDropdownState } from "./workday/locate-dropdown";
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
  /** Pause after typing, before Enter, so the framework commits the value. */
  settleAfterTypeMs: number;
  /** Pause after Enter, before reading the dropdown, so the search can start. */
  settleAfterEnterMs: number;
  /** On an empty/"no matches" state, wait this long and re-read once before accepting it. */
  emptyRecheckMs: number;
}

const MAX_ATTEMPTS_PER_SKILL = 2;

const DEFAULT_TIMING: EngineTiming = {
  optionsTimeoutMs: 8000,
  verifyTimeoutMs: 4000,
  betweenSkillsMs: 250,
  settleAfterTypeMs: 400,
  settleAfterEnterMs: 800,
  emptyRecheckMs: 1500,
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

    // Let the framework commit the typed value before searching — pressing
    // Enter immediately makes Workday search a stale/partial query.
    await delay(timing.settleAfterTypeMs, signal);

    // Workday CACHES the previous search: typing can re-open the dropdown
    // showing the LAST query's results before the new search runs. Pressing
    // Enter while that menu is open can toggle its highlighted row instead
    // of searching — so close it first and wait until it is actually gone.
    let stale = readDropdownState(field);
    if (stale) {
      dismissDropdown(field);
      try {
        await waitFor(() => (readDropdownState(field) === null ? true : null), {
          description: "the cached dropdown to close",
          timeoutMs: 1500,
          signal,
        });
        stale = null; // closed cleanly; whatever appears next is fresh
      } catch (err) {
        if (!(err instanceof TimeoutError)) throw err;
        // Menu refuses to close — keep its contents as a staleness
        // fingerprint so they can't be mistaken for fresh results.
      }
    }

    // Workday's Skills search box only opens its suggestion dropdown after
    // an explicit Enter press — typing alone shows nothing.
    pressEnter(field);

    // Give the search a moment to start so a transient pre-search state
    // isn't mistaken for the result.
    await delay(timing.settleAfterEnterMs, signal);

    // Wait for the dropdown tied to this input to produce a usable state:
    // either it contains the exact match (fine even if it is the cached
    // list — those rows are live and selectable), or its contents CHANGED
    // from the pre-Enter snapshot (a genuinely fresh result), or an
    // explicit empty state that is fresh.
    let state;
    try {
      state = await waitFor(
        () => {
          const current = readDropdownState(field);
          if (!current) return null;
          if (hasExactOption(current, skill)) return current;
          return sameDropdownState(current, stale) ? null : current;
        },
        {
          description: `fresh suggestions for "${skill}"`,
          timeoutMs: timing.optionsTimeoutMs,
          signal,
        },
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        clearQuery(field);
        dismissDropdown(field);
        lastFailure = { skill, status: "timed-out", detail: err.message };
        continue;
      }
      throw err;
    }

    if (!hasExactOption(state, skill)) {
      // Fresh but matchless (or fresh empty state): results can still be
      // streaming in — wait and re-read once before accepting "no match".
      await delay(timing.emptyRecheckMs, signal);
      const recheck = readDropdownState(field);
      if (recheck && hasExactOption(recheck, skill)) {
        state = recheck;
      } else {
        clearQuery(field);
        dismissDropdown(field);
        return { skill, status: "no-exact-match" };
      }
    }

    const match = state.options.find((opt) => isExactMatch(optionText(opt), skill))!;

    // Checkbox-multiselect guard: a checked row means the skill is already
    // selected — clicking it would REMOVE the skill.
    if (isOptionSelected(match)) {
      clearQuery(field);
      dismissDropdown(field);
      return { skill, status: "already-present" };
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

function hasExactOption(state: { options: HTMLElement[] }, skill: string): boolean {
  return state.options.some((opt) => isExactMatch(optionText(opt), skill));
}

/** Same dropdown contents (kind + option texts) as the stale snapshot. */
function sameDropdownState(
  a: { kind: string; options: HTMLElement[] },
  b: { kind: string; options: HTMLElement[] } | null,
): boolean {
  if (b === null) return false;
  if (a.kind !== b.kind) return false;
  const at = a.options.map(optionText);
  const bt = b.options.map(optionText);
  return at.length === bt.length && at.every((t, i) => t === bt[i]);
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

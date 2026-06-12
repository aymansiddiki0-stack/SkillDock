import { CancelledError, TimeoutError, waitFor, delay } from "./wait";
import { isExactMatch } from "./normalization";
import { locateSkillsField } from "./workday/locate-skills-field";
import { clearQuery, clickOption, dismissDropdown, pressEnter, pressKey, typeQuery } from "./workday/interact-with-combobox";
import { activeOption, isOptionSelected, optionText, popupDiagnostics, readDropdownState } from "./workday/locate-dropdown";
import { isSkillSelected, selectionConfirmed, snapshotSelection } from "./workday/verify-selection";
import type { RunProgress, SkillResult } from "./types";

export interface EngineOptions {
  field: HTMLInputElement;
  skills: string[];
  signal: AbortSignal;
  onProgress: (progress: RunProgress) => void;
  /** Overridable timeouts (tests use short values). */
  timing?: Partial<EngineTiming>;
  debug?: boolean;
}

export interface EngineTiming {
  /** Max wait for suggestions after entering a query. */
  optionsTimeoutMs: number;
  /** Max wait for the selected-chip confirmation after clicking an option. */
  verifyTimeoutMs: number;
  /** Max wait for the Skills field to reappear after a rerender. */
  reacquireFieldTimeoutMs: number;
  /** Max wait for a cached dropdown to close before treating it as stale. */
  staleDropdownCloseTimeoutMs: number;
  /** Small settle delay between skills. */
  betweenSkillsMs: number;
  /** Pause after typing, before Enter, so the framework commits the value. */
  settleAfterTypeMs: number;
  /** Pause after Enter, before reading the dropdown, so the search can start. */
  settleAfterEnterMs: number;
  /** On an empty/"no matches" state, wait this long and re-read once before accepting it. */
  emptyRecheckMs: number;
  /** Pause after setting the value wholesale, before checking it stuck. */
  typeCommitCheckMs: number;
  /** Per-character pacing for the character-by-character typing fallback. */
  typeFallbackCharMs: number;
  /** Pause after the typing fallback completes, before checking it stuck. */
  typeFallbackSettleMs: number;
  /** Pause between ArrowDown presses in the keyboard-highlight fallback. */
  arrowStepDelayMs: number;
  /** Safety-net poll interval for waits on non-mutation state changes. */
  pollMs: number;
}

const MAX_ATTEMPTS_PER_SKILL = 2;

const DEFAULT_TIMING: EngineTiming = {
  optionsTimeoutMs: 8000,
  verifyTimeoutMs: 4000,
  reacquireFieldTimeoutMs: 5000,
  staleDropdownCloseTimeoutMs: 1500,
  betweenSkillsMs: 250,
  settleAfterTypeMs: 400,
  settleAfterEnterMs: 800,
  emptyRecheckMs: 1500,
  typeCommitCheckMs: 60,
  typeFallbackCharMs: 25,
  typeFallbackSettleMs: 60,
  arrowStepDelayMs: 80,
  pollMs: 150,
};

export async function runFillEngine(opts: EngineOptions): Promise<SkillResult[]> {
  const timing: EngineTiming = { ...DEFAULT_TIMING, ...opts.timing };
  const { skills, signal, onProgress } = opts;
  const log = opts.debug
    ? (...args: unknown[]) => console.warn("[SkillDock]", ...args)
    : () => undefined;

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
      field = await reacquireField(field, timing, signal);
      const result = await processSkill(field, skill, timing, signal, log);
      console.warn(`[SkillDock] "${result.skill}" → ${result.status}${result.detail ? ` (${result.detail})` : ""}`);
      results.push(result);
    } catch (err) {
      if (err instanceof CancelledError) {
        results.push({ skill, status: "cancelled" });
      } else {
        results.push({ skill, status: "error", detail: errorMessage(err) });
        log("error for", skill, err);
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
async function reacquireField(field: HTMLInputElement, timing: EngineTiming, signal: AbortSignal): Promise<HTMLInputElement> {
  if (field.isConnected) return field;
  const found = await waitFor(
    () => {
      const res = locateSkillsField(field.ownerDocument);
      return res.kind === "found" && res.field instanceof HTMLInputElement ? res.field : null;
    },
    {
      description: "the Skills field to reappear after a rerender",
      timeoutMs: timing.reacquireFieldTimeoutMs,
      pollMs: timing.pollMs,
      signal,
    },
  );
  return found;
}

async function processSkill(
  field: HTMLInputElement,
  skill: string,
  timing: EngineTiming,
  signal: AbortSignal,
  log: (...args: unknown[]) => void,
): Promise<SkillResult> {
  if (isSkillSelected(field, skill)) {
    return { skill, status: "already-present" };
  }

  let lastFailure: SkillResult | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_SKILL; attempt++) {
    if (!field.isConnected) field = await reacquireField(field, timing, signal);

    const typed = await typeQuery(field, skill, timing, signal);
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
          timeoutMs: timing.staleDropdownCloseTimeoutMs,
          pollMs: timing.pollMs,
          signal,
        });
        stale = null; // closed cleanly; whatever appears next is fresh
      } catch (err) {
        if (!(err instanceof TimeoutError)) throw err;
        // Menu refuses to close — keep its contents as a staleness
        // fingerprint so they can't be mistaken for fresh results.
        log("cached dropdown would not close; tracking it as stale");
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
          pollMs: timing.pollMs,
          signal,
        },
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        diagnose(field, `no fresh dropdown results for "${skill}" before timeout`);
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
        const texts = (recheck ?? state).options.map(optionText);
        console.warn(
          `[SkillDock] no exact match for "${skill}". Workday offered:`,
          texts.length > 0 ? texts : "(no options — empty result)",
        );
        clearQuery(field);
        dismissDropdown(field);
        return { skill, status: "no-exact-match" };
      }
    }

    const match = state.options.find((opt) => isExactMatch(optionText(opt), skill))!;
    log("options", state.options.map(optionText), "→ match:", optionText(match));

    // Checkbox-multiselect guard: a checked row means the skill is already
    // selected — clicking it would REMOVE the skill.
    if (isOptionSelected(match)) {
      clearQuery(field);
      dismissDropdown(field);
      return { skill, status: "already-present" };
    }

    const before = snapshotSelection(field);
    let selectedVia = "click";
    clickOption(match);
    let confirmed = await confirmSelection(field, before, skill, match, timing, signal);

    if (!confirmed) {
      // Some tenants ignore page-dispatched clicks entirely. Keyboard
      // interaction is known to work on those (typing + Enter already ran
      // the search), so fall back to it: ArrowDown until the highlighted
      // row (aria-activedescendant) is the exact match, then press Enter.
      const highlighted = await highlightByKeyboard(field, skill, state.listbox, timing, signal, log);
      if (highlighted) {
        selectedVia = "keyboard";
        pressKey(field, "Enter");
        confirmed = await confirmSelection(field, before, skill, highlighted, timing, signal);
        if (!confirmed) {
          // A few checkbox menus toggle on Space instead of Enter.
          pressKey(field, " ", "Space");
          confirmed = await confirmSelection(field, before, skill, highlighted, timing, signal);
        }
      }
    }

    if (confirmed) {
      log("selected", skill, "via", selectedVia);
      if (field.isConnected) {
        clearQuery(field);
        dismissDropdown(field);
      }
      return { skill, status: "added" };
    }

    // Last chance: the confirmation signals may simply have been missed —
    // most often because a rerender swapped the input out from under us.
    if (!field.isConnected) field = await reacquireField(field, timing, signal);
    if (isSkillSelected(field, skill)) return { skill, status: "added" };
    clearQuery(field);
    dismissDropdown(field);
    diagnose(field, `selected exact match for "${skill}" (via ${selectedVia}) but Workday never showed it as selected`);
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
 * Wait until the skill shows as selected — a chip appears, or the given
 * option row flips to its checked state. False on timeout.
 */
async function confirmSelection(
  field: HTMLInputElement,
  before: ReturnType<typeof snapshotSelection>,
  skill: string,
  option: HTMLElement,
  timing: EngineTiming,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await waitFor(
      () =>
        selectionConfirmed(field, before, skill) || (option.isConnected && isOptionSelected(option))
          ? true
          : null,
      {
        description: `confirmation that "${skill}" was added`,
        timeoutMs: timing.verifyTimeoutMs,
        pollMs: timing.pollMs,
        signal,
      },
    );
    return true;
  } catch (err) {
    if (err instanceof TimeoutError) return false;
    throw err;
  }
}

const MAX_ARROW_STEPS = 40;

/**
 * Step through the open menu with ArrowDown until the row referenced by the
 * input's aria-activedescendant is an exact match for the skill. Returns the
 * highlighted row, or null when the menu doesn't expose keyboard highlight
 * tracking or a full pass found no exact match. Never presses Enter on a row
 * it hasn't verified.
 */
async function highlightByKeyboard(
  field: HTMLInputElement,
  skill: string,
  listbox: Element | null,
  timing: EngineTiming,
  signal: AbortSignal,
  log: (...args: unknown[]) => void,
): Promise<HTMLElement | null> {
  const seen = new Set<string>();
  for (let step = 0; step < MAX_ARROW_STEPS; step++) {
    const active = activeOption(field, listbox);
    if (active) {
      if (isExactMatch(optionText(active), skill)) return active;
      const id = active.id;
      if (id) {
        if (seen.has(id)) {
          log("keyboard highlight wrapped around without an exact match for", skill);
          return null; // full cycle, no exact match
        }
        seen.add(id);
      }
    } else if (step > 2) {
      log("menu does not expose aria-activedescendant; keyboard fallback unavailable");
      return null; // arrowing produces no trackable highlight
    }
    pressKey(field, "ArrowDown");
    try {
      await delay(timing.arrowStepDelayMs, signal);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Log a compact markup snapshot of popup candidates to the page console so
 * unrecognized tenant markup can be reported and supported. Markup only.
 */
function diagnose(field: HTMLInputElement, reason: string): void {
  try {
    console.warn(`[SkillDock diagnostic] ${reason}. Copy everything below and share it to get this tenant supported:`);
    for (const line of popupDiagnostics(field)) console.warn("[SkillDock diagnostic]", line);
  } catch {
    /* diagnostics must never break the run */
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

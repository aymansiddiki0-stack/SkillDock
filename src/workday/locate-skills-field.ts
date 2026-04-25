/**
 * Semantic Skills-field locator.
 *
 * Workday tenants render the Skills autocomplete with varying markup, so this
 * locator never keys off generated class names, randomized IDs, or a fixed DOM
 * shape. Instead it collects every editable text/search input and combobox on
 * the page, scores each candidate with centralized semantic signals, and
 * accepts a candidate only when its score clears a threshold AND clearly beats
 * the runner-up. Otherwise detection is reported as ambiguous and the user can
 * pick the field manually.
 */

import { accessibleName, automationIdChain, isEditableField, isVisible, nearestHeadingText } from "../dom";

export interface ScoredCandidate {
  element: HTMLElement;
  score: number;
  reasons: string[];
}

export type LocateResult =
  | { kind: "found"; field: HTMLElement; score: number; reasons: string[] }
  | { kind: "ambiguous"; candidates: ScoredCandidate[] }
  | { kind: "not-found" };

const SKILLS_WORD = /\bskills?\b/i;

/** Fields that must never be treated as the Skills field. */
const DISQUALIFYING_NAME =
  /\b(location|city|country|state|school|university|college|degree|field of study|language|phone|email|name|address|search jobs|how did you hear|source|website|linkedin)\b/i;

const ACCEPT_THRESHOLD = 6;
const LEAD_MARGIN = 3;

export function scoreCandidate(el: HTMLElement): ScoredCandidate | null {
  if (!isEditableField(el) || !isVisible(el)) return null;

  const name = accessibleName(el);
  const heading = nearestHeadingText(el);
  if (DISQUALIFYING_NAME.test(name)) return null;

  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${points >= 0 ? "+" : ""}${points} ${reason}`);
  };

  if (SKILLS_WORD.test(name)) add(5, `accessible name mentions skills ("${name}")`);
  if (SKILLS_WORD.test(heading)) add(4, `nearest heading mentions skills ("${heading}")`);

  const role = el.getAttribute("role");
  if (role === "combobox" || el.getAttribute("aria-autocomplete")) {
    add(2, "combobox / aria-autocomplete semantics");
  }
  if (el.hasAttribute("aria-expanded") || el.hasAttribute("aria-controls") || el.hasAttribute("aria-owns")) {
    add(1, "owns/controls a popup");
  }

  const autoIds = automationIdChain(el);
  if (autoIds.some((id) => id.includes("skill"))) {
    add(4, "workday automation id mentions skills");
  }
  if (autoIds.some((id) => id.includes("multiselect") || id.includes("searchbox"))) {
    add(2, "workday multiselect/search-box container");
  }

  // A selected-values container with removable chips next to the input is a
  // strong multiselect signal (but never sufficient on its own).
  const container = fieldContainer(el);
  if (container) {
    const hasChips =
      container.querySelector("[data-automation-id='selectedItem']") !== null ||
      containerHasRemovableChip(container);
    if (hasChips) add(2, "selected-value chips present in the same field container");
  }

  if (score <= 0) return null;
  return { element: el, score, reasons };
}

function containerHasRemovableChip(container: Element): boolean {
  for (const btn of container.querySelectorAll("button")) {
    const label = (btn.getAttribute("aria-label") ?? btn.textContent ?? "").toLowerCase();
    if (/\b(remove|delete|clear)\b/.test(label) && btn.closest("[role='listitem'], li, [data-automation-id]")) {
      return true;
    }
  }
  return false;
}

/**
 * The container that scopes one form field (input + chips + label). Prefers
 * Workday's stable formField/multiselect automation containers, then generic
 * grouping elements, then a bounded ancestor.
 */
export function fieldContainer(el: Element): Element | null {
  return (
    el.closest("[data-automation-id^='formField'], [data-automation-id*='multiselect' i]") ??
    el.closest("fieldset, [role='group']") ??
    boundedAncestor(el, 4)
  );
}

function boundedAncestor(el: Element, levels: number): Element | null {
  let node: Element | null = el;
  for (let i = 0; i < levels && node?.parentElement; i++) node = node.parentElement;
  return node;
}

export function collectCandidates(doc: Document = document): HTMLElement[] {
  const selector = "input[type='text'], input[type='search'], input:not([type]), [role='combobox']";
  const seen = new Set<Element>();
  const out: HTMLElement[] = [];
  for (const el of doc.querySelectorAll(selector)) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (el instanceof HTMLElement) out.push(el);
  }
  return out;
}

export function locateSkillsField(doc: Document = document): LocateResult {
  const scored = collectCandidates(doc)
    .map(scoreCandidate)
    .filter((c): c is ScoredCandidate => c !== null)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: "not-found" };

  const [best, second] = scored;
  if (best && best.score >= ACCEPT_THRESHOLD && (!second || best.score - second.score >= LEAD_MARGIN || second.score < ACCEPT_THRESHOLD)) {
    return { kind: "found", field: best.element, score: best.score, reasons: best.reasons };
  }
  return { kind: "ambiguous", candidates: scored.slice(0, 5) };
}

/**
 * Semantic Skills-field locator.
 *
 * Workday tenants render the Skills autocomplete with varying markup, so this
 * locator never keys off generated class names, randomized IDs, or a fixed DOM
 * shape. Instead it collects every editable text/search input and combobox on
 * the page, scores each candidate with centralized semantic signals, and
 * returns the highest scorer.
 */

import { accessibleName, isEditableField, isVisible, nearestHeadingText } from "../dom";

export interface ScoredCandidate {
  element: HTMLElement;
  score: number;
  reasons: string[];
}

const SKILLS_WORD = /\bskills?\b/i;

export function scoreCandidate(el: HTMLElement): ScoredCandidate | null {
  if (!isEditableField(el) || !isVisible(el)) return null;

  const name = accessibleName(el);
  const heading = nearestHeadingText(el);

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

  if (score <= 0) return null;
  return { element: el, score, reasons };
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

export function locateSkillsField(doc: Document = document): HTMLElement | null {
  const scored = collectCandidates(doc)
    .map(scoreCandidate)
    .filter((c): c is ScoredCandidate => c !== null)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.element ?? null;
}

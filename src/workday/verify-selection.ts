/**
 * Read the skills Workday currently shows as selected, and verify that a
 * selection actually took effect.
 *
 * Selected values are detected only through strong chip/token signals scoped
 * to the field's own container — a skill is never considered "present"
 * because its text appears elsewhere on the page.
 */

import { isVisible } from "../dom";
import { isExactMatch, normalizeDisplay } from "../normalization";
import { fieldContainer } from "./locate-skills-field";

const REMOVE_LABEL = /\b(remove|delete|clear)\b/i;

function chipText(chip: Element): string {
  // Prefer visible text with any remove-button label stripped out.
  const clone = chip.cloneNode(true) as Element;
  for (const btn of clone.querySelectorAll("button, [role='button']")) btn.remove();
  const text = normalizeDisplay(clone.textContent ?? "");
  if (text) return text;
  // Chip whose only text lives in the remove button's aria-label,
  // e.g. "Remove Python".
  const btn = chip.querySelector("button[aria-label], [role='button'][aria-label]");
  const label = btn?.getAttribute("aria-label") ?? "";
  const m = label.match(/^(?:remove|delete|clear)\s+(.*)$/i);
  return m ? normalizeDisplay(m[1] ?? "") : "";
}

/** Currently selected skill values in the field's container. */
export function getSelectedSkills(field: HTMLElement): string[] {
  const container = fieldContainer(field);
  if (!container) return [];

  const values: string[] = [];
  const seen = new Set<Element>();
  const record = (chip: Element) => {
    if (seen.has(chip) || !isVisible(chip)) return;
    seen.add(chip);
    const text = chipText(chip);
    if (text) values.push(text);
  };

  // 1. Workday's stable chip hook.
  for (const chip of container.querySelectorAll("[data-automation-id='selectedItem']")) record(chip);

  // 2. Generic token pattern: an element containing a remove/delete button.
  if (values.length === 0) {
    for (const btn of container.querySelectorAll("button, [role='button']")) {
      const label = (btn.getAttribute("aria-label") ?? btn.textContent ?? "").trim();
      if (!REMOVE_LABEL.test(label)) continue;
      const chip = btn.closest("[role='listitem'], li, [data-automation-id]") ?? btn.parentElement;
      if (chip && chip !== container) record(chip);
    }
  }
  return values;
}

export function isSkillSelected(field: HTMLElement, skill: string): boolean {
  return getSelectedSkills(field).some((v) => isExactMatch(v, skill));
}

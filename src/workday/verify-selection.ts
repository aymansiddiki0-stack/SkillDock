/**
 * Read the skills Workday currently shows as selected.
 *
 * Selected values are detected only through strong chip/token signals scoped
 * to the field's own container — a skill is never considered "present"
 * because its text appears elsewhere on the page.
 */

import { isVisible } from "../dom";
import { isExactMatch, normalizeDisplay } from "../normalization";
import { fieldContainer } from "./locate-skills-field";

/** Currently selected skill values in the field's container. */
export function getSelectedSkills(field: HTMLElement): string[] {
  const container = fieldContainer(field);
  if (!container) return [];

  const values: string[] = [];
  for (const chip of container.querySelectorAll("[data-automation-id='selectedItem']")) {
    if (!isVisible(chip)) continue;
    const text = normalizeDisplay(chip.textContent ?? "");
    if (text) values.push(text);
  }
  return values;
}

export function isSkillSelected(field: HTMLElement, skill: string): boolean {
  return getSelectedSkills(field).some((v) => isExactMatch(v, skill));
}

import { isEditableField, isVisible } from "../dom";

/** Ordered from most to least specific. First hit wins. */
const SKILLS_SELECTORS = [
  "[data-automation-id='skillsPrompt'] input",
  "[data-automation-id='formField-skills'] input",
  "input[aria-label='Skills']",
  "input[placeholder='Skills']",
  "#skills-input",
];

export function locateSkillsField(doc: Document = document): HTMLInputElement | null {
  for (const selector of SKILLS_SELECTORS) {
    for (const el of doc.querySelectorAll(selector)) {
      if (el instanceof HTMLInputElement && isEditableField(el) && isVisible(el)) {
        return el;
      }
    }
  }
  return null;
}

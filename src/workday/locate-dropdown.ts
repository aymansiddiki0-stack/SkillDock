import { isVisible } from "../dom";
import { normalizeDisplay } from "../normalization";

export interface DropdownState {
  kind: "options" | "empty";
  listbox: Element | null;
  options: HTMLElement[];
}

function idTokens(input: Element, attr: string): string[] {
  return (input.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean);
}

function resolveAriaTarget(input: Element): Element | null {
  const doc = input.ownerDocument;
  for (const attr of ["aria-controls", "aria-owns"]) {
    for (const id of idTokens(input, attr)) {
      const el = doc.getElementById(id);
      if (el && isVisible(el)) return el;
    }
  }
  return null;
}

function visibleOptions(container: Element): HTMLElement[] {
  const opts: HTMLElement[] = [];
  for (const el of container.querySelectorAll("[role='option']")) {
    if (!(el instanceof HTMLElement)) continue;
    if (!isVisible(el)) continue;
    if (el.getAttribute("aria-disabled") === "true") continue;
    opts.push(el);
  }
  return opts;
}

/** Display text of one option, using only allowed display normalization. */
export function optionText(option: Element): string {
  return normalizeDisplay(option.textContent ?? "");
}

export function readDropdownState(input: HTMLElement): DropdownState | null {
  const linked = resolveAriaTarget(input);
  if (!linked) return null;
  const options = visibleOptions(linked);
  if (options.length === 0) return null;
  return { kind: "options", listbox: linked, options };
}

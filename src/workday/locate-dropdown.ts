import { isVisible, queryAllDeep } from "../dom";
import { normalizeDisplay } from "../normalization";

export interface DropdownState {
  kind: "options" | "empty";
  listbox: Element | null;
  options: HTMLElement[];
}

const NO_MATCH_TEXT = /\bno (matches|results|items|suggestions)\b/i;

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
  const active = input.getAttribute("aria-activedescendant");
  if (active) {
    const opt = doc.getElementById(active);
    const listbox = opt?.closest("[role='listbox']");
    if (listbox && isVisible(listbox)) return listbox;
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

/**
 * Read the current dropdown state for `input`, or null when no associated
 * dropdown is currently visible. Never picks between multiple unrelated
 * candidate popups.
 */
export function readDropdownState(input: HTMLElement): DropdownState | null {
  const doc = input.ownerDocument;

  const linked = resolveAriaTarget(input);
  if (linked) {
    const options = visibleOptions(linked);
    if (options.length > 0) return { kind: "options", listbox: linked, options };
    if (NO_MATCH_TEXT.test(linked.textContent ?? "")) return { kind: "empty", listbox: linked, options: [] };
    return null; // linked popup exists but has not produced content yet
  }

  // Fallback: an unambiguous visible listbox anywhere in the document —
  // Workday portals the suggestion popup under <body>, outside the field.
  const candidates = queryAllDeep("[role='listbox']", doc).filter(
    (el) => isVisible(el) && (visibleOptions(el).length > 0 || NO_MATCH_TEXT.test(el.textContent ?? "")),
  );
  if (candidates.length === 1) {
    const container = candidates[0]!;
    const options = visibleOptions(container);
    if (options.length > 0) return { kind: "options", listbox: container, options };
    return { kind: "empty", listbox: container, options: [] };
  }

  // With multiple recognizable containers visible, the situation is
  // ambiguous — never guess between unrelated popups.
  return null;
}

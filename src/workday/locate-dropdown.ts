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

const OPTION_SELECTOR =
  "[role='option'], [data-automation-id='menuItem'], [data-automation-id='promptOption'], [data-automation-id='promptLeafNode']";

/**
 * Workday renders the ALREADY-SELECTED pills strip as a role=listbox
 * (data-automation-id="selectedItemList") whose pills are role=option
 * menuItems — markup that is nearly identical to a suggestions dropdown.
 * Anything in or around it must never be treated as a dropdown or option.
 */
function isSelectedValuesDisplay(el: Element): boolean {
  if (el.closest("[data-automation-id='selectedItemList'], [data-automation-id='selectedItem']")) return true;
  return el.querySelector("[data-automation-id='selectedItem'], [data-automation-id='DELETE_charm']") !== null;
}

/** Keep only elements whose ancestors are not themselves in the set. */
function outermost(els: HTMLElement[]): HTMLElement[] {
  return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
}

function visibleOptions(container: Element): HTMLElement[] {
  const opts: HTMLElement[] = [];
  for (const el of container.querySelectorAll(OPTION_SELECTOR)) {
    if (!(el instanceof HTMLElement)) continue;
    if (!isVisible(el)) continue;
    if (el.getAttribute("aria-disabled") === "true") continue;
    if (isSelectedValuesDisplay(el)) continue; // pills are not suggestions
    opts.push(el);
  }
  // A Workday row matches several selectors at once (menuItem →
  // promptLeafNode → promptOption); collapse to one element per row.
  return outermost([...new Set(opts)]);
}

/**
 * Whether an option is already in the selected state. Workday's Skills menu
 * is a checkbox multiselect: clicking a selected row would REMOVE the skill,
 * so this must be checked before clicking, and it doubles as selection
 * confirmation after clicking.
 *
 * CAUTION: in these menus aria-selected marks the keyboard-HIGHLIGHTED row
 * (Workday highlights the first row on open), not the checked one. When any
 * checkbox signal is present, only checkbox signals decide; aria-selected is
 * consulted only for menus without checkboxes.
 */
export function isOptionSelected(option: Element): boolean {
  const signals: boolean[] = [];

  const ariaLabel = option.getAttribute("aria-label") ?? "";
  if (/\bnot checked\b/i.test(ariaLabel)) signals.push(false);
  else if (/\bchecked\b/i.test(ariaLabel)) signals.push(true);

  const marked = [option, ...option.querySelectorAll("[data-automation-checked], [data-automationcheckboxchecked], input[type='checkbox']")];
  for (const el of marked) {
    const checkedId = el.getAttribute("data-automation-checked");
    if (checkedId !== null) signals.push(checkedId.trim().toLowerCase() === "checked");
    const checkedBox = el.getAttribute("data-automationcheckboxchecked");
    if (checkedBox !== null) signals.push(checkedBox.trim().toLowerCase() === "true");
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      signals.push(el.checked || el.getAttribute("aria-checked") === "true");
    }
  }

  if (signals.length > 0) return signals.some(Boolean);

  // No checkbox anywhere: plain multiselect menus mark selection via ARIA.
  return option.getAttribute("aria-selected") === "true" || option.getAttribute("data-automation-selected") === "true";
}

/** Display text of one option, using only allowed display normalization. */
export function optionText(option: Element): string {
  // Workday puts the canonical option label in data-automation-label on the
  // promptOption node; textContent can include checkbox scaffolding.
  const labelEl = option.matches("[data-automation-label]")
    ? option
    : option.querySelector("[data-automation-label]");
  const label = labelEl?.getAttribute("data-automation-label");
  return normalizeDisplay(label ?? option.textContent ?? "");
}

/**
 * Read the current dropdown state for `input`, or null when no associated
 * dropdown is currently visible. Never picks between multiple unrelated
 * candidate popups.
 */
export function readDropdownState(input: HTMLElement): DropdownState | null {
  const doc = input.ownerDocument;

  const linkedTarget = resolveAriaTarget(input);
  const linked = linkedTarget && !isSelectedValuesDisplay(linkedTarget) ? linkedTarget : null;
  if (linked) {
    const options = visibleOptions(linked);
    if (options.length > 0) return { kind: "options", listbox: linked, options };
    if (NO_MATCH_TEXT.test(linked.textContent ?? "")) return { kind: "empty", listbox: linked, options: [] };
    return null; // linked popup exists but has not produced content yet
  }

  // Fallback: an unambiguous visible suggestion container anywhere in the
  // document (Workday portals the popup under <body>), including open shadow
  // roots. Real Workday popups do not always use role=listbox: cover ARIA
  // listboxes, Workday's activeListContainer, and any popup holding
  // promptOption items.
  const candidates = queryAllDeep(
    "[role='listbox'], [data-automation-id='activeListContainer'], [data-automation-id='popUpContainer'], [data-automation-id='menuContainer']",
    doc,
  ).filter(
    (el) =>
      isVisible(el) &&
      !isSelectedValuesDisplay(el) &&
      (visibleOptions(el).length > 0 || NO_MATCH_TEXT.test(el.textContent ?? "")),
  );

  // Collapse nested candidates (e.g. a listbox inside a popup container) to
  // their outermost container so one popup counts once.
  const containers = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));

  if (containers.length === 1) {
    const container = containers[0]!;
    const options = visibleOptions(container);
    if (options.length > 0) return { kind: "options", listbox: container, options };
    return { kind: "empty", listbox: container, options: [] };
  }

  // With multiple recognizable containers visible, the situation is
  // ambiguous — never guess between unrelated popups.
  if (containers.length > 1) return null;

  // Last resort: visible option rows exist but their container has no
  // recognizable role/automation id (Workday's virtualized skills menu).
  // Group them under their nearest common ancestor and treat that as the
  // popup — options only exist in the document while a popup is open.
  const looseOptions = outermost(
    queryAllDeep(OPTION_SELECTOR, doc).filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        isVisible(el) &&
        el !== input &&
        !el.contains(input) &&
        el.getAttribute("aria-disabled") !== "true" &&
        !isSelectedValuesDisplay(el),
    ),
  );
  if (looseOptions.length > 0) {
    let ancestor: Element | null = looseOptions[0]!.parentElement;
    while (ancestor && !looseOptions.every((o) => ancestor!.contains(o))) ancestor = ancestor.parentElement;
    if (ancestor) return { kind: "options", listbox: ancestor, options: looseOptions };
  }

  // Some tenants render an explicit "no matches" panel without a listbox role.
  const emptyPanels = queryAllDeep("[data-automation-id]", doc).filter(
    (el) => isVisible(el) && NO_MATCH_TEXT.test(el.textContent ?? "") && el.textContent!.length < 80,
  );
  if (emptyPanels.length > 0 && doc.activeElement === input) {
    return { kind: "empty", listbox: null, options: [] };
  }

  return null;
}

/**
 * The option currently highlighted by keyboard navigation, resolved through
 * the input's aria-activedescendant. Null when nothing is highlighted or the
 * pattern isn't in use.
 */
export function activeOption(input: HTMLElement, listbox: Element | null = null): HTMLElement | null {
  // Workday puts aria-activedescendant on the dropdown container
  // (activeListContainer), not the input — check both.
  for (const src of [input, listbox]) {
    const id = src?.getAttribute("aria-activedescendant");
    if (!id) continue;
    const el = input.ownerDocument.getElementById(id);
    if (el instanceof HTMLElement && isVisible(el)) return el;
  }
  return null;
}

import { normalizeDisplay } from "./normalization";

/**
 * jsdom (used by the test suite) has no layout engine, so every rect is
 * empty. Detect once whether layout information is available; when it is not,
 * fall back to style/attribute checks only.
 */
let layoutSupport: boolean | null = null;
function hasLayoutSupport(): boolean {
  if (layoutSupport === null) {
    layoutSupport = document.documentElement.getClientRects().length > 0;
  }
  return layoutSupport;
}

export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (node instanceof HTMLElement && node.hidden) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  if (hasLayoutSupport()) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
  }
  return true;
}

export function isEditableField(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    const type = el.type.toLowerCase();
    return type === "text" || type === "search";
  }
  return false;
}

/**
 * Simplified accessible-name computation, sufficient for form fields:
 * aria-labelledby → aria-label → <label for> → wrapping <label> → placeholder.
 */
export function accessibleName(el: Element): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .filter(Boolean);
    if (parts.length > 0) return normalizeDisplay(parts.join(" "));
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return normalizeDisplay(ariaLabel);
  if (el.id) {
    const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent) return normalizeDisplay(label.textContent);
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) return normalizeDisplay(wrappingLabel.textContent);
  const placeholder = el.getAttribute("placeholder");
  if (placeholder) return normalizeDisplay(placeholder);
  return "";
}

/**
 * Text of the nearest preceding heading/legend for an element, walking up the
 * ancestor chain and looking at earlier siblings. Bounded so it cannot scan
 * the entire page.
 */
export function nearestHeadingText(el: Element, maxAncestors = 8): string {
  const isHeading = (node: Element) =>
    /^H[1-6]$/.test(node.tagName) ||
    node.tagName === "LEGEND" ||
    node.getAttribute("role") === "heading";

  let node: Element | null = el;
  for (let depth = 0; node && depth < maxAncestors; depth++) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (isHeading(sib)) return normalizeDisplay(sib.textContent ?? "");
      const nested = sib.querySelector("h1,h2,h3,h4,h5,h6,legend,[role='heading']");
      if (nested) return normalizeDisplay(nested.textContent ?? "");
    }
    node = node.parentElement;
    if (node && isHeading(node)) return normalizeDisplay(node.textContent ?? "");
  }
  return "";
}

/**
 * Collect elements matching `selector` in the document and inside any *open*
 * shadow roots (one recursive pass; closed shadow roots are not accessible
 * and are not bypassed).
 */
export function queryAllDeep(selector: string, root: ParentNode = document): Element[] {
  const out: Element[] = [...root.querySelectorAll(selector)];
  const walker = root.querySelectorAll("*");
  for (const el of walker) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) out.push(...queryAllDeep(selector, shadow));
  }
  return out;
}

/** data-automation-id of the element or its nearest ancestor that has one. */
export function automationIdChain(el: Element, maxAncestors = 10): string[] {
  const ids: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < maxAncestors; depth++) {
    const id = node.getAttribute("data-automation-id");
    if (id) ids.push(id.toLowerCase());
    node = node.parentElement;
  }
  return ids;
}

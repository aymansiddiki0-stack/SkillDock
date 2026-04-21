import { normalizeDisplay } from "./normalization";

export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (node instanceof HTMLElement && node.hidden) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
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

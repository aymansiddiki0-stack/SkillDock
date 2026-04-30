function fire(el: HTMLElement, event: Event): void {
  el.dispatchEvent(event);
}

export function focusField(input: HTMLElement): void {
  input.scrollIntoView({ block: "center" });
  fire(input, new MouseEvent("mousedown", { bubbles: true }));
  input.focus();
  fire(input, new MouseEvent("click", { bubbles: true }));
}

export function clearQuery(input: HTMLInputElement): void {
  input.value = "";
  fire(input, new Event("input", { bubbles: true }));
}

export function typeQuery(input: HTMLInputElement, text: string): void {
  focusField(input);
  input.value = text;
  fire(input, new Event("input", { bubbles: true }));
  fire(input, new Event("change", { bubbles: true }));
}

export function clickOption(option: HTMLElement): void {
  fire(option, new MouseEvent("click", { bubbles: true, cancelable: true }));
}

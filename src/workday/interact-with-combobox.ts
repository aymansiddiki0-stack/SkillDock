import { delay } from "../wait";

function nativeValueSetter(input: HTMLInputElement): (value: string) => void {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const set = desc?.set;
  if (set) return (value) => set.call(input, value);
  return (value) => {
    input.value = value;
  };
}

function fire(el: HTMLElement, event: Event): void {
  el.dispatchEvent(event);
}

function inputEvents(el: HTMLInputElement, data: string | null, inputType: string): void {
  fire(el, new InputEvent("beforeinput", { bubbles: true, cancelable: true, data, inputType }));
  fire(el, new InputEvent("input", { bubbles: true, data, inputType }));
}

function focusField(input: HTMLElement): void {
  input.scrollIntoView({ block: "center" });
  fire(input, new PointerEvent("pointerdown", { bubbles: true }));
  fire(input, new MouseEvent("mousedown", { bubbles: true }));
  input.focus();
  fire(input, new PointerEvent("pointerup", { bubbles: true }));
  fire(input, new MouseEvent("mouseup", { bubbles: true }));
  fire(input, new MouseEvent("click", { bubbles: true }));
}

/** Clear any query text currently in the field. */
export function clearQuery(input: HTMLInputElement): void {
  if (input.value === "") return;
  nativeValueSetter(input)("");
  inputEvents(input, null, "deleteContentBackward");
}

/**
 * Enter `text` into the field, returning true when the value stuck.
 * Falls back to character-by-character entry for frameworks that reset
 * wholesale value assignment.
 */
export async function typeQuery(input: HTMLInputElement, text: string, signal?: AbortSignal): Promise<boolean> {
  focusField(input);
  clearQuery(input);

  const setValue = nativeValueSetter(input);
  setValue(text);
  inputEvents(input, text, "insertText");
  await delay(60, signal);
  if (input.value === text) return true;

  // Fallback: controlled character-by-character entry.
  clearQuery(input);
  let expected = "";
  for (const ch of text) {
    expected += ch;
    fire(input, new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
    setValue(expected);
    inputEvents(input, ch, "insertText");
    fire(input, new KeyboardEvent("keyup", { key: ch, bubbles: true }));
    await delay(25, signal);
  }
  await delay(60, signal);
  return input.value === text;
}

export function clickOption(option: HTMLElement): void {
  fire(option, new MouseEvent("click", { bubbles: true, cancelable: true }));
}

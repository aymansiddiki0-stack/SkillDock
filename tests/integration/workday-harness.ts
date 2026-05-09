/**
 * A small interactive stand-in for Workday's Skills multiselect, driven by
 * real DOM events, so the fill engine can be exercised end-to-end in jsdom:
 *
 *  - typing into the input renders a portal listbox under <body> after a
 *    configurable delay, filtered by case-insensitive substring (like a real
 *    autocomplete — the *server* is fuzzy, our matching must not be);
 *  - clicking an option adds a selectedItem chip, clears the input, and
 *    removes the listbox (optionally after a delay).
 *
 * Original markup, not copied from any Workday tenant.
 */

export interface HarnessOptions {
  catalog: string[];
  preselected?: string[];
  /** Delay before suggestions render. */
  suggestDelayMs?: number;
  /** Delay before the chip appears after clicking an option. */
  chipDelayMs?: number;
  /** Link the listbox via aria-controls instead of relying on portal lookup. */
  ariaLinked?: boolean;
  /** Replace the input element after this many successful selections. */
  rerenderAfterSelections?: number;
  /** When true, clicking an option silently does nothing (verification must fail). */
  swallowSelections?: boolean;
}

export interface Harness {
  input: HTMLInputElement;
  selected: () => string[];
  destroy: () => void;
}

export function mountHarness(opts: HarnessOptions): Harness {
  const {
    catalog,
    preselected = [],
    suggestDelayMs = 30,
    chipDelayMs = 0,
    ariaLinked = false,
    rerenderAfterSelections,
    swallowSelections = false,
  } = opts;

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  document.body.innerHTML = `
    <div>
      <h3>Skills</h3>
      <div data-automation-id="formField-skillsPrompt">
        <div data-automation-id="multiselectInputContainer">
          <ul data-automation-id="selectedItemList"></ul>
        </div>
      </div>
    </div>`;
  const container = document.querySelector("[data-automation-id='multiselectInputContainer']")!;
  const chipList = container.querySelector("[data-automation-id='selectedItemList']")!;

  for (const value of preselected) addChip(value);

  let selections = 0;
  let input = createInput();
  container.appendChild(input);

  function createInput(): HTMLInputElement {
    const el = document.createElement("input");
    el.type = "text";
    el.setAttribute("aria-label", "Skills");
    el.setAttribute("role", "combobox");
    el.setAttribute("aria-expanded", "false");
    el.setAttribute("data-automation-id", "searchBox");
    // Real Workday behavior: typing alone shows nothing; only Enter searches.
    el.addEventListener("input", () => removeListbox());
    el.addEventListener("keydown", (ev) => {
      if ((ev as KeyboardEvent).key === "Enter") onSearch();
    });
    return el;
  }

  function addChip(value: string): void {
    const li = document.createElement("li");
    li.setAttribute("data-automation-id", "selectedItem");
    const span = document.createElement("span");
    span.textContent = value;
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", `Remove ${value}`);
    btn.textContent = "×";
    li.append(span, btn);
    chipList.appendChild(li);
  }

  function removeListbox(): void {
    document.getElementById("harness-listbox")?.remove();
    input.setAttribute("aria-expanded", "false");
    if (ariaLinked) input.removeAttribute("aria-controls");
  }

  function onSearch(): void {
    const query = input.value;
    removeListbox();
    if (query === "") return;
    later(() => {
      if (input.value !== query) return; // stale render
      const matches = catalog.filter((c) => c.toLowerCase().includes(query.toLowerCase()));
      const lb = document.createElement("ul");
      lb.id = "harness-listbox";
      lb.setAttribute("role", "listbox");
      if (matches.length === 0) lb.textContent = "No matches found";
      for (const text of matches) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = text;
        li.addEventListener("click", () => onSelect(text));
        lb.appendChild(li);
      }
      document.body.appendChild(lb); // portal mount, like Workday
      input.setAttribute("aria-expanded", "true");
      if (ariaLinked) input.setAttribute("aria-controls", "harness-listbox");
    }, suggestDelayMs);
  }

  function onSelect(value: string): void {
    if (swallowSelections) return;
    removeListbox();
    input.value = "";
    later(() => {
      addChip(value);
      selections++;
      if (rerenderAfterSelections !== undefined && selections === rerenderAfterSelections) {
        // Simulate a React rerender replacing the input node.
        const fresh = createInput();
        input.replaceWith(fresh);
        input = fresh;
      }
    }, chipDelayMs);
  }

  return {
    get input() {
      return input;
    },
    selected: () =>
      [...chipList.querySelectorAll("[data-automation-id='selectedItem'] span")].map(
        (el) => el.textContent ?? "",
      ),
    destroy: () => {
      for (const id of timers) clearTimeout(id);
      removeListbox();
      document.body.innerHTML = "";
    },
  };
}

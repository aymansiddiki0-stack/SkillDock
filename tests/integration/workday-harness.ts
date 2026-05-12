/**
 * A small interactive stand-in for Workday's Skills multiselect, driven by
 * real DOM events, so the fill engine can be exercised end-to-end in jsdom:
 *
 *  - typing into the input renders a portal listbox under <body> after a
 *    configurable delay, filtered by case-insensitive substring (like a real
 *    autocomplete — the *server* is fuzzy, our matching must not be);
 *  - clicking an option adds a selectedItem chip, clears the input, and
 *    removes the listbox (optionally after a delay);
 *  - the input can be swapped out mid-run to simulate a React rerender.
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
  /**
   * "menu" markup only: ignore all clicks (like tenants that reject
   * page-dispatched clicks) — selection works only via ArrowDown +
   * Enter/Space keyboard navigation with aria-activedescendant tracking.
   */
  ignoreClicks?: boolean;
  /**
   * "aria" (default): a role=listbox with role=option items.
   * "prompt": no ARIA roles — an activeListContainer holding promptOption
   * divs, with the click handler on the inner promptOption node.
   * "menu": Workday's real skills menu — menuItem rows (role=option) with a
   * checkbox and a promptOption carrying data-automation-label, the click
   * handler on promptLeafNode, an unmarked container, NO chips (selection is
   * shown only by the checked state), and clicking a checked row REMOVES it.
   */
  markup?: "aria" | "prompt" | "menu";
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
    markup = "aria",
    ignoreClicks = false,
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

  if (markup === "menu") {
    // Real tenant: the pills strip is itself a listbox of role=option pills.
    chipList.setAttribute("role", "listbox");
    chipList.setAttribute("aria-label", "items selected");
    for (const value of preselected) addPill(value);
  } else {
    for (const value of preselected) addChip(value);
  }

  let selections = 0;
  const menuChecked = new Set<string>(markup === "menu" ? preselected : []);
  let highlightIndex = -1;
  let cachedMatches: string[] = [];
  let input = createInput();
  container.appendChild(input);

  function createInput(): HTMLInputElement {
    const el = document.createElement("input");
    el.type = "text";
    el.setAttribute("aria-label", "Skills");
    el.setAttribute("role", "combobox");
    el.setAttribute("aria-expanded", "false");
    el.setAttribute("data-automation-id", "searchBox");
    // Real Workday behavior: typing alone shows nothing NEW — but for the
    // menu markup, typing re-opens the dropdown with the CACHED results of
    // the previous search; only Enter produces fresh results.
    el.addEventListener("input", () => {
      removeListbox();
      if (markup === "menu" && cachedMatches.length > 0 && el.value !== "") {
        renderMenu(cachedMatches);
      }
    });
    el.addEventListener("keydown", (ev) => {
      const key = (ev as KeyboardEvent).key;
      if (markup === "menu" && document.getElementById("harness-listbox")) {
        const rows = [...document.querySelectorAll("#harness-listbox [data-automation-id='menuItem']")];
        if (key === "Escape") {
          removeListbox();
          return;
        }
        if (key === "ArrowDown" && rows.length > 0) {
          rows[highlightIndex]?.setAttribute("aria-selected", "false");
          highlightIndex = (highlightIndex + 1) % rows.length;
          const row = rows[highlightIndex] as HTMLElement;
          row.setAttribute("aria-selected", "true");
          document.getElementById("harness-listbox")?.setAttribute("aria-activedescendant", row.id);
          return;
        }
        if ((key === "Enter" || key === " ") && highlightIndex >= 0) {
          const row = rows[highlightIndex] as HTMLElement;
          const leaf = row.querySelector("[data-automation-id='promptLeafNode']")!;
          const box = row.querySelector("[data-automation-id='checkbox']")!;
          const label = row.querySelector("[data-automation-label]")!.getAttribute("data-automation-label")!;
          onMenuToggle(label, row, leaf, box, true);
          return;
        }
      }
      if (key === "Enter") onSearch();
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
    highlightIndex = -1;
    input.removeAttribute("aria-activedescendant");
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
      if (markup === "menu") {
        cachedMatches = matches;
        renderMenu(matches);
        return;
      }
      const lb = document.createElement(markup === "aria" ? "ul" : "div");
      lb.id = "harness-listbox";
      if (markup === "prompt") {
        // No ARIA roles anywhere — detection must rely on automation ids.
        lb.setAttribute("data-automation-id", "activeListContainer");
        if (matches.length === 0) lb.textContent = "No matches found";
        for (const text of matches) {
          const row = document.createElement("div"); // inert wrapper row
          const opt = document.createElement("div");
          opt.setAttribute("data-automation-id", "promptOption");
          opt.textContent = text;
          // Handler lives on the promptOption node only, like real Workday:
          // clicking any wrapper must not select.
          opt.addEventListener("click", () => onSelect(text));
          row.appendChild(opt);
          lb.appendChild(row);
        }
      } else {
        lb.setAttribute("role", "listbox");
        if (matches.length === 0) lb.textContent = "No matches found";
        for (const text of matches) {
          const li = document.createElement("li");
          li.setAttribute("role", "option");
          li.textContent = text;
          li.addEventListener("click", () => onSelect(text));
          lb.appendChild(li);
        }
      }
      document.body.appendChild(lb); // portal mount, like Workday
      input.setAttribute("aria-expanded", "true");
      if (ariaLinked) input.setAttribute("aria-controls", "harness-listbox");
    }, suggestDelayMs);
  }

  function renderMenu(matches: string[]): void {
    removeListbox();
    const lb = document.createElement("div");
    lb.id = "harness-listbox";
    // Unmarked container — detection must group rows by common ancestor.
    let rowIndex = 0;
    for (const text of matches) {
      const row = document.createElement("div");
      row.id = `harness-menu-item-${rowIndex}`;
      row.setAttribute("role", "option");
      row.setAttribute("data-automation-id", "menuItem");
      // Like real Workday: aria-selected marks the keyboard HIGHLIGHT —
      // the first row is highlighted the moment the menu opens — while
      // the checked state lives only in checkbox markers + aria-label.
      row.setAttribute("aria-selected", String(rowIndex === 0));
      row.setAttribute("aria-label", `${text} ${menuChecked.has(text) ? "checked" : "not checked"}`);
      rowIndex++;
      const leaf = document.createElement("div");
      leaf.setAttribute("data-automation-id", "promptLeafNode");
      leaf.setAttribute("data-automation-checked", menuChecked.has(text) ? "Checked" : "Not Checked");
      const box = document.createElement("div");
      box.setAttribute("data-automation-id", "checkbox");
      box.setAttribute("data-automationcheckboxchecked", String(menuChecked.has(text)));
      const opt = document.createElement("div");
      opt.setAttribute("data-automation-id", "promptOption");
      opt.setAttribute("data-automation-label", text);
      opt.textContent = text;
      leaf.append(box, opt);
      // Handler on the leaf widget only, toggling the checked state.
      leaf.addEventListener("click", () => onMenuToggle(text, row, leaf, box, false));
      row.appendChild(leaf);
      lb.appendChild(row);
    }
    document.body.appendChild(lb);
    if (matches.length > 0) {
      highlightIndex = 0;
      lb.setAttribute("aria-activedescendant", "harness-menu-item-0");
    }
    input.setAttribute("aria-expanded", "true");
  }

  function onMenuToggle(value: string, row: Element, leaf: Element, box: Element, viaKeyboard: boolean): void {
    if (swallowSelections) return;
    if (ignoreClicks && !viaKeyboard) return; // tenant rejects synthetic clicks
    const nowChecked = !menuChecked.has(value);
    if (nowChecked) menuChecked.add(value);
    else menuChecked.delete(value); // clicking a checked row REMOVES the skill
    later(() => {
      const label = row.querySelector("[data-automation-label]")!.getAttribute("data-automation-label")!;
      row.setAttribute("aria-label", `${label} ${nowChecked ? "checked" : "not checked"}`);
      leaf.setAttribute("data-automation-checked", nowChecked ? "Checked" : "Not Checked");
      box.setAttribute("data-automationcheckboxchecked", String(nowChecked));
      if (nowChecked) addPill(value);
      else removePill(value);
      selections++;
    }, chipDelayMs);
  }

  /** Selected pill styled like the real tenant's selectedItemList entries. */
  function addPill(value: string): void {
    const li = document.createElement("li");
    li.setAttribute("role", "presentation");
    li.setAttribute("data-automation-id", "menuItem");
    const pill = document.createElement("div");
    pill.setAttribute("role", "option");
    pill.setAttribute("data-automation-id", "selectedItem");
    pill.setAttribute("aria-label", `${value}, press delete to clear value.`);
    const charm = document.createElement("div");
    charm.setAttribute("data-automation-id", "DELETE_charm");
    const label = document.createElement("p");
    label.setAttribute("data-automation-id", "promptOption");
    label.setAttribute("data-automation-label", value);
    label.textContent = value;
    pill.append(charm, label);
    li.appendChild(pill);
    chipList.appendChild(li);
  }

  function removePill(value: string): void {
    for (const label of chipList.querySelectorAll("[data-automation-label]")) {
      if (label.getAttribute("data-automation-label") === value) {
        label.closest("li")?.remove();
        return;
      }
    }
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
      markup === "menu"
        ? [...menuChecked]
        : [...chipList.querySelectorAll("[data-automation-id='selectedItem'] span")].map(
            (el) => el.textContent ?? "",
          ),
    destroy: () => {
      for (const id of timers) clearTimeout(id);
      removeListbox();
      document.body.innerHTML = "";
    },
  };
}

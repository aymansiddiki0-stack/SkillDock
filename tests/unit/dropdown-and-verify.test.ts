import { beforeEach, describe, expect, it } from "vitest";
import { resetDom } from "../fixtures/load";
import { optionText, readDropdownState } from "../../src/workday/locate-dropdown";

beforeEach(resetDom);

function makeInput(attrs: Record<string, string> = {}): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
  document.body.appendChild(input);
  return input;
}

function makeListbox(id: string, options: string[], parent: Element = document.body): HTMLElement {
  const ul = document.createElement("ul");
  ul.id = id;
  ul.setAttribute("role", "listbox");
  for (const text of options) {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.textContent = text;
    ul.appendChild(li);
  }
  parent.appendChild(ul);
  return ul;
}

describe("readDropdownState", () => {
  it("prefers the aria-controls listbox even when others exist", () => {
    const input = makeInput({ "aria-controls": "mine" });
    makeListbox("other", ["Decoy Option"]);
    makeListbox("mine", ["Python", "Python Programming"]);
    const state = readDropdownState(input);
    expect(state?.kind).toBe("options");
    expect(state?.options.map(optionText)).toEqual(["Python", "Python Programming"]);
  });

  it("resolves a portal-mounted listbox under document.body without ARIA links", () => {
    const input = makeInput();
    makeListbox("portal", ["C++", "C#"]);
    const state = readDropdownState(input);
    expect(state?.kind).toBe("options");
    expect(state?.options.map(optionText)).toEqual(["C++", "C#"]);
  });

  it("returns null when multiple unrelated listboxes are visible and unlinked", () => {
    const input = makeInput();
    makeListbox("a", ["One"]);
    makeListbox("b", ["Two"]);
    expect(readDropdownState(input)).toBeNull();
  });

  it("ignores the selected-pills strip (a listbox of selectedItem pills) next to the real dropdown", () => {
    // Real Workday: after the first selection, the field shows a
    // role=listbox pills strip that must never count as a dropdown.
    document.body.innerHTML = `
      <div>
        <ul role="listbox" data-automation-id="selectedItemList" aria-label="items selected">
          <li role="presentation" data-automation-id="menuItem">
            <div role="option" data-automation-id="selectedItem" aria-label="Apache Airflow, press delete to clear value.">
              <div data-automation-id="DELETE_charm"></div>
              <p data-automation-id="promptOption" data-automation-label="Apache Airflow">Apache Airflow</p>
            </div>
          </li>
        </ul>
        <input type="text" aria-label="Skills" role="combobox" />
      </div>
      <div data-automation-id="activeListContainer" role="listbox" aria-activedescendant="mi-1">
        <div id="mi-1" role="option" data-automation-id="menuItem" aria-label="Database Development not checked">
          <div data-automation-id="promptLeafNode" data-automation-checked="Not Checked">
            <div data-automation-id="promptOption" data-automation-label="Database Development">Database Development</div>
          </div>
        </div>
      </div>`;
    const input = document.querySelector("input")!;
    const state = readDropdownState(input);
    expect(state?.kind).toBe("options");
    expect(state?.options.map(optionText)).toEqual(["Database Development"]);
  });

  it("skips disabled and hidden options", () => {
    const input = makeInput({ "aria-controls": "lb" });
    const lb = makeListbox("lb", ["Visible"]);
    const disabled = document.createElement("li");
    disabled.setAttribute("role", "option");
    disabled.setAttribute("aria-disabled", "true");
    disabled.textContent = "Disabled";
    const hidden = document.createElement("li");
    hidden.setAttribute("role", "option");
    hidden.style.display = "none";
    hidden.textContent = "Hidden";
    lb.append(disabled, hidden);
    const state = readDropdownState(input);
    expect(state?.options.map(optionText)).toEqual(["Visible"]);
  });

  it("detects an explicit 'no matches' empty state", () => {
    const input = makeInput({ "aria-controls": "lb" });
    const lb = makeListbox("lb", []);
    lb.textContent = "No matches found";
    const state = readDropdownState(input);
    expect(state?.kind).toBe("empty");
  });

  it("normalizes option text rendered across nested elements", () => {
    const input = makeInput({ "aria-controls": "lb" });
    const lb = makeListbox("lb", []);
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.innerHTML = "<span>Amazon</span>\n  <span>Web Services (AWS)</span>";
    lb.appendChild(li);
    const state = readDropdownState(input);
    expect(state?.options.map(optionText)).toEqual(["Amazon Web Services (AWS)"]);
  });
});

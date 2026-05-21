"use strict";
(() => {
  // src/wait.ts
  var TimeoutError = class extends Error {
    constructor(description, timeoutMs) {
      super(`Timed out after ${timeoutMs}ms waiting for ${description}`);
      this.name = "TimeoutError";
    }
  };
  var CancelledError = class extends Error {
    constructor() {
      super("Cancelled");
      this.name = "CancelledError";
    }
  };
  function waitFor(check, opts) {
    const { description, timeoutMs, signal, pollMs = 150 } = opts;
    const root = opts.root ?? document.documentElement;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new CancelledError());
        return;
      }
      let observer = null;
      let timeoutId = null;
      let intervalId = null;
      let settled = false;
      const cleanup = () => {
        settled = true;
        observer?.disconnect();
        observer = null;
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (intervalId !== null) clearInterval(intervalId);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        cleanup();
        reject(new CancelledError());
      };
      const attempt = () => {
        if (settled) return;
        let value;
        try {
          value = check();
        } catch (err) {
          cleanup();
          reject(err);
          return;
        }
        if (value !== null) {
          cleanup();
          resolve(value);
        }
      };
      attempt();
      if (settled) return;
      signal?.addEventListener("abort", onAbort);
      observer = new MutationObserver(attempt);
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
      intervalId = setInterval(attempt, pollMs);
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new TimeoutError(description, timeoutMs));
      }, timeoutMs);
    });
  }
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new CancelledError());
        return;
      }
      const id = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(id);
        reject(new CancelledError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  // src/normalization.ts
  var SPACE_LIKE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
  function normalizeDisplay(text) {
    return text.normalize("NFC").replace(SPACE_LIKE, " ").replace(/\s+/g, " ").trim();
  }
  function isExactMatch(a, b) {
    return normalizeDisplay(a) === normalizeDisplay(b);
  }

  // src/dom.ts
  var layoutSupport = null;
  function hasLayoutSupport() {
    if (layoutSupport === null) {
      layoutSupport = document.documentElement.getClientRects().length > 0;
    }
    return layoutSupport;
  }
  function isVisible(el) {
    if (!el.isConnected) return false;
    for (let node = el; node; node = node.parentElement) {
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
  function isEditableField(el) {
    if (el instanceof HTMLInputElement) {
      if (el.disabled || el.readOnly) return false;
      const type = el.type.toLowerCase();
      return type === "text" || type === "search";
    }
    return false;
  }
  function accessibleName(el) {
    const doc = el.ownerDocument;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? "").filter(Boolean);
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
  function nearestHeadingText(el, maxAncestors = 8) {
    const isHeading = (node2) => /^H[1-6]$/.test(node2.tagName) || node2.tagName === "LEGEND" || node2.getAttribute("role") === "heading";
    let node = el;
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
  function queryAllDeep(selector, root = document) {
    const out = [...root.querySelectorAll(selector)];
    const walker = root.querySelectorAll("*");
    for (const el of walker) {
      const shadow = el.shadowRoot;
      if (shadow) out.push(...queryAllDeep(selector, shadow));
    }
    return out;
  }
  function automationIdChain(el, maxAncestors = 10) {
    const ids = [];
    let node = el;
    for (let depth = 0; node && depth < maxAncestors; depth++) {
      const id = node.getAttribute("data-automation-id");
      if (id) ids.push(id.toLowerCase());
      node = node.parentElement;
    }
    return ids;
  }

  // src/workday/locate-skills-field.ts
  var SKILLS_WORD = /\bskills?\b/i;
  var DISQUALIFYING_NAME = /\b(location|city|country|state|school|university|college|degree|field of study|language|phone|email|name|address|search jobs|how did you hear|source|website|linkedin)\b/i;
  var DISQUALIFYING_ANCESTOR = "nav, header[role='banner'], [role='navigation'], [role='search'], [role='banner']";
  var ACCEPT_THRESHOLD = 6;
  var LEAD_MARGIN = 3;
  function scoreCandidate(el) {
    if (!isEditableField(el) || !isVisible(el)) return null;
    if (el.closest(DISQUALIFYING_ANCESTOR)) return null;
    const name = accessibleName(el);
    const heading = nearestHeadingText(el);
    if (DISQUALIFYING_NAME.test(name)) return null;
    let score = 0;
    const reasons = [];
    const add = (points, reason) => {
      score += points;
      reasons.push(`${points >= 0 ? "+" : ""}${points} ${reason}`);
    };
    if (SKILLS_WORD.test(name)) add(5, `accessible name mentions skills ("${name}")`);
    if (SKILLS_WORD.test(heading)) add(4, `nearest heading mentions skills ("${heading}")`);
    const role = el.getAttribute("role");
    if (role === "combobox" || el.getAttribute("aria-autocomplete")) {
      add(2, "combobox / aria-autocomplete semantics");
    }
    if (el.hasAttribute("aria-expanded") || el.hasAttribute("aria-controls") || el.hasAttribute("aria-owns")) {
      add(1, "owns/controls a popup");
    }
    const autoIds = automationIdChain(el);
    if (autoIds.some((id) => id.includes("skill"))) {
      add(4, "workday automation id mentions skills");
    }
    if (autoIds.some((id) => id.includes("multiselect") || id.includes("searchbox"))) {
      add(2, "workday multiselect/search-box container");
    }
    const container = fieldContainer(el);
    if (container) {
      const hasChips = container.querySelector("[data-automation-id='selectedItem']") !== null || containerHasRemovableChip(container);
      if (hasChips) add(2, "selected-value chips present in the same field container");
    }
    if (score <= 0) return null;
    return { element: el, score, reasons };
  }
  function containerHasRemovableChip(container) {
    for (const btn of container.querySelectorAll("button")) {
      const label = (btn.getAttribute("aria-label") ?? btn.textContent ?? "").toLowerCase();
      if (/\b(remove|delete|clear)\b/.test(label) && btn.closest("[role='listitem'], li, [data-automation-id]")) {
        return true;
      }
    }
    return false;
  }
  function fieldContainer(el) {
    return el.closest("[data-automation-id^='formField'], [data-automation-id*='multiselect' i]") ?? el.closest("fieldset, [role='group']") ?? boundedAncestor(el, 4);
  }
  function boundedAncestor(el, levels) {
    let node = el;
    for (let i = 0; i < levels && node?.parentElement; i++) node = node.parentElement;
    return node;
  }
  function collectCandidates(doc = document) {
    const selector = "input[type='text'], input[type='search'], input:not([type]), [role='combobox']";
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const el of queryAllDeep(selector, doc)) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el instanceof HTMLElement) out.push(el);
    }
    return out;
  }
  function locateSkillsField(doc = document) {
    const scored = collectCandidates(doc).map(scoreCandidate).filter((c) => c !== null).sort((a, b) => b.score - a.score);
    if (scored.length === 0) return { kind: "not-found" };
    const [best, second] = scored;
    if (best && best.score >= ACCEPT_THRESHOLD && (!second || best.score - second.score >= LEAD_MARGIN || second.score < ACCEPT_THRESHOLD)) {
      return { kind: "found", field: best.element, score: best.score, reasons: best.reasons };
    }
    return { kind: "ambiguous", candidates: scored.slice(0, 5) };
  }

  // src/workday/interact-with-combobox.ts
  function nativeValueSetter(input) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const set = desc?.set;
    if (set) return (value) => set.call(input, value);
    return (value) => {
      input.value = value;
    };
  }
  function fire(el, event) {
    el.dispatchEvent(event);
  }
  function inputEvents(el, data, inputType) {
    fire(el, new InputEvent("beforeinput", { bubbles: true, cancelable: true, data, inputType }));
    fire(el, new InputEvent("input", { bubbles: true, data, inputType }));
  }
  function keyEvents(el, key) {
    const init2 = { key, bubbles: true, cancelable: true };
    fire(el, new KeyboardEvent("keydown", init2));
    fire(el, new KeyboardEvent("keyup", init2));
  }
  function focusField(input) {
    input.scrollIntoView({ block: "center" });
    fire(input, new PointerEvent("pointerdown", { bubbles: true }));
    fire(input, new MouseEvent("mousedown", { bubbles: true }));
    input.focus();
    fire(input, new PointerEvent("pointerup", { bubbles: true }));
    fire(input, new MouseEvent("mouseup", { bubbles: true }));
    fire(input, new MouseEvent("click", { bubbles: true }));
  }
  function clearQuery(input) {
    if (input.value === "") return;
    nativeValueSetter(input)("");
    inputEvents(input, null, "deleteContentBackward");
  }
  async function typeQuery(input, text, signal) {
    focusField(input);
    clearQuery(input);
    const setValue = nativeValueSetter(input);
    setValue(text);
    inputEvents(input, text, "insertText");
    await delay(60, signal);
    if (input.value === text) return true;
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
  function pressEnter(input) {
    const init2 = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    };
    fire(input, new KeyboardEvent("keydown", init2));
    fire(input, new KeyboardEvent("keypress", init2));
    fire(input, new KeyboardEvent("keyup", init2));
  }
  function pressKey(input, key, code = key) {
    const init2 = { key, code, bubbles: true, cancelable: true };
    fire(input, new KeyboardEvent("keydown", init2));
    fire(input, new KeyboardEvent("keyup", init2));
  }
  function dismissDropdown(input) {
    keyEvents(input, "Escape");
  }
  function clickOption(option) {
    const inner = option.querySelector("[data-automation-id='promptLeafNode']") ?? option.querySelector("[data-automation-id='promptOption']");
    const target = inner instanceof HTMLElement ? inner : option;
    target.scrollIntoView({ block: "nearest" });
    const rect = target.getBoundingClientRect();
    const coords = {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      bubbles: true
    };
    fire(target, new PointerEvent("pointerdown", { ...coords, pointerId: 1, isPrimary: true }));
    fire(target, new MouseEvent("mousedown", { ...coords, cancelable: true }));
    fire(target, new PointerEvent("pointerup", { ...coords, pointerId: 1, isPrimary: true }));
    fire(target, new MouseEvent("mouseup", { ...coords }));
    fire(target, new MouseEvent("click", { ...coords, cancelable: true }));
  }

  // src/workday/locate-dropdown.ts
  var NO_MATCH_TEXT = /\bno (matches|results|items|suggestions)\b/i;
  function idTokens(input, attr) {
    return (input.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean);
  }
  function resolveAriaTarget(input) {
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
  var OPTION_SELECTOR = "[role='option'], [data-automation-id='menuItem'], [data-automation-id='promptOption'], [data-automation-id='promptLeafNode']";
  function isSelectedValuesDisplay(el) {
    if (el.closest("[data-automation-id='selectedItemList'], [data-automation-id='selectedItem']")) return true;
    return el.querySelector("[data-automation-id='selectedItem'], [data-automation-id='DELETE_charm']") !== null;
  }
  function outermost(els) {
    return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
  }
  function visibleOptions(container) {
    const opts = [];
    for (const el of container.querySelectorAll(OPTION_SELECTOR)) {
      if (!(el instanceof HTMLElement)) continue;
      if (!isVisible(el)) continue;
      if (el.getAttribute("aria-disabled") === "true") continue;
      if (isSelectedValuesDisplay(el)) continue;
      opts.push(el);
    }
    return outermost([...new Set(opts)]);
  }
  function isOptionSelected(option) {
    const signals = [];
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
    return option.getAttribute("aria-selected") === "true" || option.getAttribute("data-automation-selected") === "true";
  }
  function optionText(option) {
    const labelEl = option.matches("[data-automation-label]") ? option : option.querySelector("[data-automation-label]");
    const label = labelEl?.getAttribute("data-automation-label");
    return normalizeDisplay(label ?? option.textContent ?? "");
  }
  function readDropdownState(input) {
    const doc = input.ownerDocument;
    const linkedTarget = resolveAriaTarget(input);
    const linked = linkedTarget && !isSelectedValuesDisplay(linkedTarget) ? linkedTarget : null;
    if (linked) {
      const options = visibleOptions(linked);
      if (options.length > 0) return { kind: "options", listbox: linked, options };
      if (NO_MATCH_TEXT.test(linked.textContent ?? "")) return { kind: "empty", listbox: linked, options: [] };
      return null;
    }
    const candidates = queryAllDeep(
      "[role='listbox'], [data-automation-id='activeListContainer'], [data-automation-id='popUpContainer'], [data-automation-id='menuContainer']",
      doc
    ).filter(
      (el) => isVisible(el) && !isSelectedValuesDisplay(el) && (visibleOptions(el).length > 0 || NO_MATCH_TEXT.test(el.textContent ?? ""))
    );
    const containers = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
    if (containers.length === 1) {
      const container = containers[0];
      const options = visibleOptions(container);
      if (options.length > 0) return { kind: "options", listbox: container, options };
      return { kind: "empty", listbox: container, options: [] };
    }
    if (containers.length > 1) return null;
    const looseOptions = outermost(
      queryAllDeep(OPTION_SELECTOR, doc).filter(
        (el) => el instanceof HTMLElement && isVisible(el) && el !== input && !el.contains(input) && el.getAttribute("aria-disabled") !== "true" && !isSelectedValuesDisplay(el)
      )
    );
    if (looseOptions.length > 0) {
      let ancestor = looseOptions[0].parentElement;
      while (ancestor && !looseOptions.every((o) => ancestor.contains(o))) ancestor = ancestor.parentElement;
      if (ancestor) return { kind: "options", listbox: ancestor, options: looseOptions };
    }
    const emptyPanels = queryAllDeep("[data-automation-id]", doc).filter(
      (el) => isVisible(el) && NO_MATCH_TEXT.test(el.textContent ?? "") && el.textContent.length < 80
    );
    if (emptyPanels.length > 0 && doc.activeElement === input) {
      return { kind: "empty", listbox: null, options: [] };
    }
    return null;
  }
  function popupDiagnostics(input) {
    const doc = input.ownerDocument;
    const seen = /* @__PURE__ */ new Set();
    const lines = [];
    const note = (label, el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const html = el.outerHTML ?? "";
      lines.push(`${label}: ${html.length > 2500 ? html.slice(0, 2500) + "\u2026[truncated]" : html}`);
    };
    const linked = resolveAriaTarget(input);
    if (linked) note("aria-linked popup", linked);
    for (const el of queryAllDeep(
      "[role='listbox'], [data-automation-id='activeListContainer'], [data-automation-id='popUpContainer'], [data-automation-id='menuContainer']",
      doc
    )) {
      if (isVisible(el)) note("candidate container", el);
    }
    for (const el of queryAllDeep("[data-automation-id*='rompt'], [data-automation-id*='option' i]", doc)) {
      if (isVisible(el)) note("candidate option", el.parentElement ?? el);
    }
    const body = doc.body;
    for (let i = body.children.length - 1; i >= 0 && i >= body.children.length - 3; i--) {
      const el = body.children[i];
      if (el instanceof HTMLElement && isVisible(el) && !el.contains(input)) note("late body child", el);
    }
    if (lines.length === 0) lines.push("no visible popup-like elements found anywhere in the document");
    return lines;
  }
  function activeOption(input, listbox = null) {
    for (const src of [input, listbox]) {
      const id = src?.getAttribute("aria-activedescendant");
      if (!id) continue;
      const el = input.ownerDocument.getElementById(id);
      if (el instanceof HTMLElement && isVisible(el)) return el;
    }
    return null;
  }

  // src/workday/verify-selection.ts
  var REMOVE_LABEL = /\b(remove|delete|clear)\b/i;
  function chipText(chip) {
    const clone = chip.cloneNode(true);
    for (const btn2 of clone.querySelectorAll("button, [role='button']")) btn2.remove();
    const text = normalizeDisplay(clone.textContent ?? "");
    if (text) return text;
    const btn = chip.querySelector("button[aria-label], [role='button'][aria-label]");
    const label = btn?.getAttribute("aria-label") ?? "";
    const m = label.match(/^(?:remove|delete|clear)\s+(.*)$/i);
    return m ? normalizeDisplay(m[1] ?? "") : "";
  }
  function getSelectedSkills(field) {
    const container = fieldContainer(field);
    if (!container) return [];
    const values = [];
    const seen = /* @__PURE__ */ new Set();
    const record = (chip) => {
      if (seen.has(chip) || !isVisible(chip)) return;
      seen.add(chip);
      const text = chipText(chip);
      if (text) values.push(text);
    };
    for (const chip of container.querySelectorAll("[data-automation-id='selectedItem']")) record(chip);
    if (values.length === 0) {
      for (const btn of container.querySelectorAll("button, [role='button']")) {
        const label = (btn.getAttribute("aria-label") ?? btn.textContent ?? "").trim();
        if (!REMOVE_LABEL.test(label)) continue;
        const chip = btn.closest("[role='listitem'], li, [data-automation-id]") ?? btn.parentElement;
        if (chip && chip !== container) record(chip);
      }
    }
    return values;
  }
  function isSkillSelected(field, skill) {
    return getSelectedSkills(field).some((v) => isExactMatch(v, skill));
  }
  function snapshotSelection(field) {
    return { values: getSelectedSkills(field) };
  }
  function selectionConfirmed(field, before, skill) {
    const beforeCount = before.values.filter((v) => isExactMatch(v, skill)).length;
    const afterCount = getSelectedSkills(field).filter((v) => isExactMatch(v, skill)).length;
    return afterCount > beforeCount;
  }

  // src/fill-engine.ts
  var MAX_ATTEMPTS_PER_SKILL = 2;
  var DEFAULT_TIMING = {
    optionsTimeoutMs: 8e3,
    verifyTimeoutMs: 4e3,
    betweenSkillsMs: 250,
    settleAfterTypeMs: 400,
    settleAfterEnterMs: 800,
    emptyRecheckMs: 1500
  };
  async function runFillEngine(opts) {
    const timing = { ...DEFAULT_TIMING, ...opts.timing };
    const { skills, signal, onProgress } = opts;
    const log = opts.debug ? (...args) => console.warn("[SkillDock]", ...args) : () => void 0;
    let field = opts.field;
    const results = [];
    const report = (current) => onProgress({ total: skills.length, completed: results.length, current });
    for (const skill of skills) {
      if (signal.aborted) {
        results.push({ skill, status: "cancelled" });
        continue;
      }
      report(skill);
      try {
        field = await reacquireField(field, signal);
        const result = await processSkill(field, skill, timing, signal, log);
        console.warn(`[SkillDock] "${result.skill}" \u2192 ${result.status}${result.detail ? ` (${result.detail})` : ""}`);
        results.push(result);
      } catch (err) {
        if (err instanceof CancelledError) {
          results.push({ skill, status: "cancelled" });
        } else {
          results.push({ skill, status: "error", detail: errorMessage(err) });
          log("error for", skill, err);
        }
      }
      report(null);
      if (!signal.aborted) {
        try {
          await delay(timing.betweenSkillsMs, signal);
        } catch {
        }
      }
    }
    return results;
  }
  async function reacquireField(field, signal) {
    if (field.isConnected) return field;
    const found = await waitFor(
      () => {
        const res = locateSkillsField(field.ownerDocument);
        return res.kind === "found" && res.field instanceof HTMLInputElement ? res.field : null;
      },
      { description: "the Skills field to reappear after a rerender", timeoutMs: 5e3, signal }
    );
    return found;
  }
  async function processSkill(field, skill, timing, signal, log) {
    if (isSkillSelected(field, skill)) {
      return { skill, status: "already-present" };
    }
    let lastFailure = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_SKILL; attempt++) {
      if (!field.isConnected) field = await reacquireField(field, signal);
      const typed = await typeQuery(field, skill, signal);
      if (!typed) {
        lastFailure = { skill, status: "error", detail: "Workday rejected the entered query text" };
        continue;
      }
      await delay(timing.settleAfterTypeMs, signal);
      let stale = readDropdownState(field);
      if (stale) {
        dismissDropdown(field);
        try {
          await waitFor(() => readDropdownState(field) === null ? true : null, {
            description: "the cached dropdown to close",
            timeoutMs: 1500,
            signal
          });
          stale = null;
        } catch (err) {
          if (!(err instanceof TimeoutError)) throw err;
          log("cached dropdown would not close; tracking it as stale");
        }
      }
      pressEnter(field);
      await delay(timing.settleAfterEnterMs, signal);
      let state;
      try {
        state = await waitFor(
          () => {
            const current = readDropdownState(field);
            if (!current) return null;
            if (hasExactOption(current, skill)) return current;
            return sameDropdownState(current, stale) ? null : current;
          },
          {
            description: `fresh suggestions for "${skill}"`,
            timeoutMs: timing.optionsTimeoutMs,
            signal
          }
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          diagnose(field, `no fresh dropdown results for "${skill}" before timeout`);
          clearQuery(field);
          dismissDropdown(field);
          lastFailure = { skill, status: "timed-out", detail: err.message };
          continue;
        }
        throw err;
      }
      if (!hasExactOption(state, skill)) {
        await delay(timing.emptyRecheckMs, signal);
        const recheck = readDropdownState(field);
        if (recheck && hasExactOption(recheck, skill)) {
          state = recheck;
        } else {
          const texts = (recheck ?? state).options.map(optionText);
          console.warn(
            `[SkillDock] no exact match for "${skill}". Workday offered:`,
            texts.length > 0 ? texts : "(no options \u2014 empty result)"
          );
          clearQuery(field);
          dismissDropdown(field);
          return { skill, status: "no-exact-match" };
        }
      }
      const match = state.options.find((opt) => isExactMatch(optionText(opt), skill));
      log("options", state.options.map(optionText), "\u2192 match:", optionText(match));
      if (isOptionSelected(match)) {
        clearQuery(field);
        dismissDropdown(field);
        return { skill, status: "already-present" };
      }
      const before = snapshotSelection(field);
      let selectedVia = "click";
      clickOption(match);
      let confirmed = await confirmSelection(field, before, skill, match, timing.verifyTimeoutMs, signal);
      if (!confirmed) {
        const highlighted = await highlightByKeyboard(field, skill, state.listbox, signal, log);
        if (highlighted) {
          selectedVia = "keyboard";
          pressKey(field, "Enter");
          confirmed = await confirmSelection(field, before, skill, highlighted, timing.verifyTimeoutMs, signal);
          if (!confirmed) {
            pressKey(field, " ", "Space");
            confirmed = await confirmSelection(field, before, skill, highlighted, timing.verifyTimeoutMs, signal);
          }
        }
      }
      if (confirmed) {
        log("selected", skill, "via", selectedVia);
        if (field.isConnected) {
          clearQuery(field);
          dismissDropdown(field);
        }
        return { skill, status: "added" };
      }
      if (!field.isConnected) field = await reacquireField(field, signal);
      if (isSkillSelected(field, skill)) return { skill, status: "added" };
      clearQuery(field);
      dismissDropdown(field);
      diagnose(field, `selected exact match for "${skill}" (via ${selectedVia}) but Workday never showed it as selected`);
      lastFailure = { skill, status: "selection-not-confirmed", detail: "Selected an exact match but Workday never showed it as selected" };
    }
    return lastFailure ?? { skill, status: "error", detail: "Exhausted retries" };
  }
  function hasExactOption(state, skill) {
    return state.options.some((opt) => isExactMatch(optionText(opt), skill));
  }
  function sameDropdownState(a, b) {
    if (b === null) return false;
    if (a.kind !== b.kind) return false;
    const at = a.options.map(optionText);
    const bt = b.options.map(optionText);
    return at.length === bt.length && at.every((t, i) => t === bt[i]);
  }
  async function confirmSelection(field, before, skill, option, timeoutMs, signal) {
    try {
      await waitFor(
        () => selectionConfirmed(field, before, skill) || option.isConnected && isOptionSelected(option) ? true : null,
        { description: `confirmation that "${skill}" was added`, timeoutMs, signal }
      );
      return true;
    } catch (err) {
      if (err instanceof TimeoutError) return false;
      throw err;
    }
  }
  var MAX_ARROW_STEPS = 40;
  async function highlightByKeyboard(field, skill, listbox, signal, log) {
    const seen = /* @__PURE__ */ new Set();
    for (let step = 0; step < MAX_ARROW_STEPS; step++) {
      const active = activeOption(field, listbox);
      if (active) {
        if (isExactMatch(optionText(active), skill)) return active;
        const id = active.id;
        if (id) {
          if (seen.has(id)) {
            log("keyboard highlight wrapped around without an exact match for", skill);
            return null;
          }
          seen.add(id);
        }
      } else if (step > 2) {
        log("menu does not expose aria-activedescendant; keyboard fallback unavailable");
        return null;
      }
      pressKey(field, "ArrowDown");
      try {
        await delay(80, signal);
      } catch {
        return null;
      }
    }
    return null;
  }
  function diagnose(field, reason) {
    try {
      console.warn(`[SkillDock diagnostic] ${reason}. Copy everything below and share it to get this tenant supported:`);
      for (const line of popupDiagnostics(field)) console.warn("[SkillDock diagnostic]", line);
    } catch {
    }
  }
  function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
  }

  // src/storage.ts
  var LAST_REPORT_KEY = "lastReport";
  async function saveLastReport(report) {
    await chrome.storage.local.set({ [LAST_REPORT_KEY]: report });
  }

  // src/content.ts
  if (!window.__skilldockLoaded) {
    window.__skilldockLoaded = true;
    init();
  }
  function init() {
    let status = { phase: "idle" };
    let controller = null;
    let manualField = null;
    let pickerCleanup = null;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      switch (message.type) {
        case "skilldock:status": {
          const response = { status };
          sendResponse(response);
          return false;
        }
        case "skilldock:cancel": {
          controller?.abort();
          sendResponse({ ok: true });
          return false;
        }
        case "skilldock:start": {
          const response = startRun(message.skills);
          sendResponse(response);
          return false;
        }
        case "skilldock:pick-field": {
          startPicker(sendResponse);
          return true;
        }
      }
    });
    function resolveField() {
      if (manualField?.isConnected) return { field: manualField };
      const located = locateSkillsField(document);
      if (located.kind === "found" && located.field instanceof HTMLInputElement) {
        return { field: located.field };
      }
      if (located.kind === "ambiguous") {
        return {
          error: "More than one field looks like the Skills field. Use \u201CPick field manually\u201D, then click the Skills input on the page."
        };
      }
      return {
        error: "No editable Workday Skills field was found. Open the application page, expand the Skills section, then try again."
      };
    }
    function startRun(skills) {
      if (status.phase === "running") {
        return { ok: false, reason: "already-running" };
      }
      if (skills.length === 0) {
        return { ok: false, reason: "detection-failed", detail: "No saved skills to fill." };
      }
      const resolved = resolveField();
      if ("error" in resolved) {
        return { ok: false, reason: "detection-failed", detail: resolved.error };
      }
      controller = new AbortController();
      const startedAt = Date.now();
      status = {
        phase: "running",
        progress: { total: skills.length, completed: 0, current: null }
      };
      void runFillEngine({
        field: resolved.field,
        skills,
        signal: controller.signal,
        onProgress: (progress) => {
          status = { phase: "running", progress };
        }
      }).then((results) => {
        finish({
          startedAt,
          finishedAt: Date.now(),
          outcome: controller?.signal.aborted ? "cancelled" : "completed",
          results
        });
      }).catch((err) => {
        finish({
          startedAt,
          finishedAt: Date.now(),
          outcome: "interrupted",
          detail: err instanceof Error ? err.message : String(err),
          results: []
        });
      });
      return { ok: true };
    }
    function finish(report) {
      status = { phase: "finished", report };
      controller = null;
      manualField = null;
      try {
        void saveLastReport(report).catch(() => void 0);
      } catch {
      }
    }
    function startPicker(sendResponse) {
      pickerCleanup?.();
      const candidates = [
        ...document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])")
      ].filter((el) => !el.disabled && !el.readOnly && el.getClientRects().length > 0);
      if (candidates.length === 0) {
        sendResponse({ ok: false, detail: "No editable text fields are visible on this page." });
        return;
      }
      const previous = /* @__PURE__ */ new Map();
      for (const el of candidates) {
        previous.set(el, el.style.outline);
        el.style.outline = "3px solid #d97706";
      }
      const cleanup = () => {
        for (const [el, outline] of previous) el.style.outline = outline;
        document.removeEventListener("pointerdown", onPick, true);
        document.removeEventListener("keydown", onKey, true);
        pickerCleanup = null;
      };
      pickerCleanup = cleanup;
      const onPick = (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && previous.has(target)) {
          manualField = target;
          cleanup();
          sendResponse({ ok: true });
        }
      };
      const onKey = (event) => {
        if (event.key === "Escape") {
          cleanup();
          sendResponse({ ok: false, detail: "Field selection cancelled." });
        }
      };
      document.addEventListener("pointerdown", onPick, true);
      document.addEventListener("keydown", onKey, true);
    }
  }
})();

"use strict";
(() => {
  // src/normalization.ts
  var SPACE_LIKE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
  function normalizeDisplay(text) {
    return text.normalize("NFC").replace(SPACE_LIKE, " ").replace(/\s+/g, " ").trim();
  }
  function parseSkillList(text) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const rawLine of text.split(/\r?\n/)) {
      const skill = normalizeDisplay(rawLine);
      if (skill.length === 0) continue;
      const key = skill;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(skill);
    }
    return out;
  }

  // src/storage.ts
  var SKILLS_KEY = "skills";
  var LAST_REPORT_KEY = "lastReport";
  async function loadSkills() {
    const data = await chrome.storage.local.get(SKILLS_KEY);
    const value = data[SKILLS_KEY];
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  }
  async function saveSkills(skills) {
    await chrome.storage.local.set({ [SKILLS_KEY]: skills });
  }
  async function loadLastReport() {
    const data = await chrome.storage.local.get(LAST_REPORT_KEY);
    return data[LAST_REPORT_KEY] ?? null;
  }

  // src/popup/popup.ts
  var $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id}`);
    return el;
  };
  var skillsInput = $("skills-input");
  var skillCount = $("skill-count");
  var saveBtn = $("save-btn");
  var saveNote = $("save-note");
  var fillBtn = $("fill-btn");
  var stopBtn = $("stop-btn");
  var pickBtn = $("pick-btn");
  var progressEl = $("progress");
  var messageEl = $("message");
  var resultsSection = $("results");
  var resultGroups = $("result-groups");
  var pollTimer = null;
  init();
  async function init() {
    const skills = await loadSkills();
    skillsInput.value = skills.join("\n");
    updateCount(skills.length);
    saveBtn.addEventListener("click", onSave);
    fillBtn.addEventListener("click", onFill);
    stopBtn.addEventListener("click", onStop);
    pickBtn.addEventListener("click", onPickField);
    const status = await sendToTab({ type: "skilldock:status" }).catch(() => null);
    if (status && "status" in status) {
      if (status.status.phase === "running") {
        enterRunningUi();
        startPolling();
        return;
      }
      if (status.status.phase === "finished" && status.status.report) {
        renderReport(status.status.report);
        return;
      }
    }
    const last = await loadLastReport();
    if (last) renderReport(last, true);
  }
  function updateCount(n) {
    skillCount.textContent = `${n} saved`;
  }
  async function onSave() {
    const skills = parseSkillList(skillsInput.value);
    await saveSkills(skills);
    skillsInput.value = skills.join("\n");
    updateCount(skills.length);
    saveNote.textContent = "Saved";
    setTimeout(() => {
      saveNote.textContent = "";
    }, 1500);
  }
  async function onFill() {
    hideMessage();
    resultsSection.hidden = true;
    pickBtn.hidden = true;
    const skills = parseSkillList(skillsInput.value);
    if (skills.length === 0) {
      showMessage("Add at least one skill, then save.", true);
      return;
    }
    await saveSkills(skills);
    skillsInput.value = skills.join("\n");
    updateCount(skills.length);
    const injected = await injectContentScript();
    if (!injected) return;
    const response = await sendToTab({ type: "skilldock:start", skills }).catch(
      () => null
    );
    if (!response) {
      showMessage("Could not reach the page. Reload the Workday tab and try again.", true);
      return;
    }
    if (!response.ok) {
      if (response.reason === "already-running") {
        enterRunningUi();
        startPolling();
        return;
      }
      showMessage(response.detail ?? "Could not find the Skills field.", true);
      pickBtn.hidden = false;
      return;
    }
    enterRunningUi();
    startPolling();
  }
  async function onStop() {
    stopBtn.disabled = true;
    await sendToTab({ type: "skilldock:cancel" }).catch(() => void 0);
  }
  async function onPickField() {
    hideMessage();
    showMessage("Click the highlighted Skills input on the page (Esc to cancel), then press Fill skills again.");
    const response = await sendToTab({ type: "skilldock:pick-field" }).catch(() => null);
    if (response?.ok) {
      showMessage("Field selected. Press Fill skills to start.");
      pickBtn.hidden = true;
    } else if (response) {
      showMessage(response.detail ?? "Field selection failed.", true);
    }
  }
  function enterRunningUi() {
    fillBtn.hidden = true;
    stopBtn.hidden = false;
    stopBtn.disabled = false;
    progressEl.hidden = false;
    progressEl.textContent = "Starting\u2026";
  }
  function exitRunningUi() {
    fillBtn.hidden = false;
    stopBtn.hidden = true;
    progressEl.hidden = true;
  }
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      const response = await sendToTab({ type: "skilldock:status" }).catch(() => null);
      if (!response || !("status" in response)) {
        stopPolling();
        exitRunningUi();
        showMessage("Lost contact with the page \u2014 the tab may have navigated or reloaded.", true);
        return;
      }
      const { status } = response;
      if (status.phase === "running" && status.progress) {
        const { completed, total, current } = status.progress;
        progressEl.textContent = current ? `${Math.min(completed + 1, total)} of ${total} \u2014 ${current}` : `${completed} of ${total}`;
      } else if (status.phase === "finished" && status.report) {
        stopPolling();
        exitRunningUi();
        renderReport(status.report);
      }
    }, 400);
  }
  function stopPolling() {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
  }
  var GROUPS = [
    { title: "Added", className: "added", statuses: ["added"] },
    { title: "Already present", className: "already-present", statuses: ["already-present"] },
    { title: "No exact Workday match", className: "no-exact-match", statuses: ["no-exact-match"] },
    { title: "Failed", className: "failed", statuses: ["timed-out", "selection-not-confirmed", "error", "cancelled"] }
  ];
  function renderReport(report, fromEarlierRun = false) {
    resultsSection.hidden = false;
    resultGroups.replaceChildren();
    if (report.outcome === "detection-failed" || report.outcome === "interrupted") {
      showMessage(report.detail ?? "The run was interrupted.", true);
    } else if (report.outcome === "cancelled") {
      showMessage("Run stopped.");
    } else if (fromEarlierRun) {
      showMessage(`Showing results from ${new Date(report.finishedAt).toLocaleString()}.`);
    }
    for (const group of GROUPS) {
      const items = report.results.filter((r) => group.statuses.includes(r.status));
      if (items.length === 0) continue;
      const wrapper = document.createElement("div");
      wrapper.className = `result-group ${group.className}`;
      const h3 = document.createElement("h3");
      h3.textContent = `${group.title} (${items.length})`;
      const ul = document.createElement("ul");
      for (const item of items) {
        const li = document.createElement("li");
        li.textContent = item.skill;
        if (item.detail || item.status === "cancelled") {
          const span = document.createElement("span");
          span.className = "result-detail";
          span.textContent = ` \u2014 ${item.status === "cancelled" ? "cancelled" : item.detail}`;
          li.appendChild(span);
        }
        ul.appendChild(li);
      }
      wrapper.append(h3, ul);
      resultGroups.appendChild(wrapper);
    }
  }
  function showMessage(text, isError = false) {
    messageEl.hidden = false;
    messageEl.textContent = text;
    messageEl.classList.toggle("error", isError);
  }
  function hideMessage() {
    messageEl.hidden = true;
    messageEl.textContent = "";
  }
  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  }
  async function injectContentScript() {
    const tabId = await activeTabId();
    if (tabId === null) {
      showMessage("No active tab found.", true);
      return false;
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return true;
    } catch {
      showMessage(
        "This page cannot be scripted. Open the Workday application tab, click the extension icon there, and try again.",
        true
      );
      return false;
    }
  }
  async function sendToTab(message) {
    const tabId = await activeTabId();
    if (tabId === null) throw new Error("no active tab");
    return chrome.tabs.sendMessage(tabId, message);
  }
})();

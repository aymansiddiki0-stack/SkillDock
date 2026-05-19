import { parseSkillList } from "../normalization";
import { loadLastReport, loadSkills, saveSkills } from "../storage";
import type { PickFieldResponse, PopupMessage, RunReport, SkillResult, StartResponse, StatusResponse } from "../types";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const skillsInput = $<HTMLTextAreaElement>("skills-input");
const skillCount = $<HTMLSpanElement>("skill-count");
const saveBtn = $<HTMLButtonElement>("save-btn");
const saveNote = $<HTMLSpanElement>("save-note");
const fillBtn = $<HTMLButtonElement>("fill-btn");
const stopBtn = $<HTMLButtonElement>("stop-btn");
const pickBtn = $<HTMLButtonElement>("pick-btn");
const progressEl = $<HTMLParagraphElement>("progress");
const messageEl = $<HTMLParagraphElement>("message");
const resultsSection = $<HTMLElement>("results");
const resultGroups = $<HTMLDivElement>("result-groups");

let pollTimer: ReturnType<typeof setInterval> | null = null;

init();

async function init(): Promise<void> {
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

function updateCount(n: number): void {
  skillCount.textContent = `${n} saved`;
}

async function onSave(): Promise<void> {
  const skills = parseSkillList(skillsInput.value);
  await saveSkills(skills);
  skillsInput.value = skills.join("\n");
  updateCount(skills.length);
  saveNote.textContent = "Saved";
  setTimeout(() => {
    saveNote.textContent = "";
  }, 1500);
}

async function onFill(): Promise<void> {
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

  const response = (await sendToTab({ type: "skilldock:start", skills }).catch(
    () => null,
  )) as StartResponse | null;

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

async function onStop(): Promise<void> {
  stopBtn.disabled = true;
  await sendToTab({ type: "skilldock:cancel" }).catch(() => undefined);
}

async function onPickField(): Promise<void> {
  hideMessage();
  showMessage("Click the highlighted Skills input on the page (Esc to cancel), then press Fill skills again.");
  const response = (await sendToTab({ type: "skilldock:pick-field" }).catch(() => null)) as PickFieldResponse | null;
  if (response?.ok) {
    showMessage("Field selected. Press Fill skills to start.");
    pickBtn.hidden = true;
  } else if (response) {
    showMessage(response.detail ?? "Field selection failed.", true);
  }
}

function enterRunningUi(): void {
  fillBtn.hidden = true;
  stopBtn.hidden = false;
  stopBtn.disabled = false;
  progressEl.hidden = false;
  progressEl.textContent = "Starting…";
}

function exitRunningUi(): void {
  fillBtn.hidden = false;
  stopBtn.hidden = true;
  progressEl.hidden = true;
}

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(async () => {
    const response = await sendToTab({ type: "skilldock:status" }).catch(() => null);
    if (!response || !("status" in response)) {
      stopPolling();
      exitRunningUi();
      showMessage("Lost contact with the page — the tab may have navigated or reloaded.", true);
      return;
    }
    const { status } = response;
    if (status.phase === "running" && status.progress) {
      const { completed, total, current } = status.progress;
      progressEl.textContent = current
        ? `${Math.min(completed + 1, total)} of ${total} — ${current}`
        : `${completed} of ${total}`;
    } else if (status.phase === "finished" && status.report) {
      stopPolling();
      exitRunningUi();
      renderReport(status.report);
    }
  }, 400);
}

function stopPolling(): void {
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
}

const GROUPS: { title: string; className: string; statuses: SkillResult["status"][] }[] = [
  { title: "Added", className: "added", statuses: ["added"] },
  { title: "Already present", className: "already-present", statuses: ["already-present"] },
  { title: "No exact Workday match", className: "no-exact-match", statuses: ["no-exact-match"] },
  { title: "Failed", className: "failed", statuses: ["timed-out", "selection-not-confirmed", "error", "cancelled"] },
];

function renderReport(report: RunReport, fromEarlierRun = false): void {
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
        span.textContent = ` — ${item.status === "cancelled" ? "cancelled" : item.detail}`;
        li.appendChild(span);
      }
      ul.appendChild(li);
    }
    wrapper.append(h3, ul);
    resultGroups.appendChild(wrapper);
  }
}

function showMessage(text: string, isError = false): void {
  messageEl.hidden = false;
  messageEl.textContent = text;
  messageEl.classList.toggle("error", isError);
}

function hideMessage(): void {
  messageEl.hidden = true;
  messageEl.textContent = "";
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function injectContentScript(): Promise<boolean> {
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
      true,
    );
    return false;
  }
}

async function sendToTab(message: PopupMessage): Promise<StatusResponse | StartResponse | PickFieldResponse | { ok: boolean }> {
  const tabId = await activeTabId();
  if (tabId === null) throw new Error("no active tab");
  return chrome.tabs.sendMessage(tabId, message);
}

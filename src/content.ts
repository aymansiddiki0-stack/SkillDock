import { runFillEngine } from "./fill-engine";
import { locateSkillsField } from "./workday/locate-skills-field";
import { saveLastReport } from "./storage";
import type { PickFieldResponse, PopupMessage, RunReport, RunStatus, StartResponse, StatusResponse } from "./types";

declare global {
  interface Window {
    __skilldockLoaded?: boolean;
  }
}

if (!window.__skilldockLoaded) {
  window.__skilldockLoaded = true;
  init();
}

function init(): void {
  let status: RunStatus = { phase: "idle" };
  let controller: AbortController | null = null;
  let manualField: HTMLInputElement | null = null;
  let pickerCleanup: (() => void) | null = null;

  chrome.runtime.onMessage.addListener((message: PopupMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "skilldock:status": {
        const response: StatusResponse = { status };
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
        return true; // async response after the user clicks a field
      }
    }
  });

  function resolveField(): { field: HTMLInputElement } | { error: string } {
    if (manualField?.isConnected) return { field: manualField };
    const located = locateSkillsField(document);
    if (located.kind === "found" && located.field instanceof HTMLInputElement) {
      return { field: located.field };
    }
    if (located.kind === "ambiguous") {
      return {
        error:
          "More than one field looks like the Skills field. Use “Pick field manually”, then click the Skills input on the page.",
      };
    }
    return {
      error:
        "No editable Workday Skills field was found. Open the application page, expand the Skills section, then try again.",
    };
  }

  function startRun(skills: string[]): StartResponse {
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
      progress: { total: skills.length, completed: 0, current: null },
    };

    void runFillEngine({
      field: resolved.field,
      skills,
      signal: controller.signal,
      onProgress: (progress) => {
        status = { phase: "running", progress };
      },
    })
      .then((results) => {
        finish({
          startedAt,
          finishedAt: Date.now(),
          outcome: controller?.signal.aborted ? "cancelled" : "completed",
          results,
        });
      })
      .catch((err: unknown) => {
        finish({
          startedAt,
          finishedAt: Date.now(),
          outcome: "interrupted",
          detail: err instanceof Error ? err.message : String(err),
          results: [],
        });
      });

    return { ok: true };
  }

  function finish(report: RunReport): void {
    status = { phase: "finished", report };
    controller = null;
    manualField = null;
    try {
      void saveLastReport(report).catch(() => undefined);
    } catch {
      /* extension context gone */
    }
  }

  function startPicker(sendResponse: (response: PickFieldResponse) => void): void {
    pickerCleanup?.();

    const candidates = [
      ...document.querySelectorAll<HTMLInputElement>("input[type='text'], input[type='search'], input:not([type])"),
    ].filter((el) => !el.disabled && !el.readOnly && el.getClientRects().length > 0);

    if (candidates.length === 0) {
      sendResponse({ ok: false, detail: "No editable text fields are visible on this page." });
      return;
    }

    const previous = new Map<HTMLElement, string>();
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

    const onPick = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && previous.has(target)) {
        manualField = target;
        cleanup();
        sendResponse({ ok: true });
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cleanup();
        sendResponse({ ok: false, detail: "Field selection cancelled." });
      }
    };
    document.addEventListener("pointerdown", onPick, true);
    document.addEventListener("keydown", onKey, true);
  }
}

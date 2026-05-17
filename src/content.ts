import { runFillEngine } from "./fill-engine";
import { locateSkillsField } from "./workday/locate-skills-field";
import { saveLastReport } from "./storage";
import type { PopupMessage, RunReport, RunStatus, StartResponse, StatusResponse } from "./types";

init();

function init(): void {
  let status: RunStatus = { phase: "idle" };
  let controller: AbortController | null = null;

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
        sendResponse(startRun(message.skills));
        return false;
      }
    }
  });

  function resolveField(): { field: HTMLInputElement } | { error: string } {
    const located = locateSkillsField(document);
    if (located.kind === "found" && located.field instanceof HTMLInputElement) {
      return { field: located.field };
    }
    if (located.kind === "ambiguous") {
      return { error: "More than one field looks like the Skills field." };
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
    void saveLastReport(report).catch(() => undefined);
  }
}

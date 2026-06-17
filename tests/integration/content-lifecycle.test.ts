/**
 * Exercises src/content.ts with a minimal chrome mock: the run must be owned
 * by the content script (popup-independent), duplicate starts must be
 * rejected, status must be queryable throughout, cancellation must work, and
 * the final report must be persisted to storage.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mountHarness, type Harness } from "./workday-harness";
import type { PopupMessage, RunStatus } from "../../src/types";

type Listener = (message: PopupMessage, sender: unknown, sendResponse: (r: unknown) => void) => unknown;

const listeners: Listener[] = [];
const stored: Record<string, unknown> = {};

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(stored, items);
        },
      },
    },
  };
  await import("../../src/content");
  expect(listeners).toHaveLength(1);
});

function send(message: PopupMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const result = listeners[0]!(message, {}, resolve);
    // Synchronous handlers call sendResponse before returning false.
    void result;
  });
}

async function status(): Promise<RunStatus> {
  const response = (await send({ type: "skilldock:status" })) as { status: RunStatus };
  return response.status;
}

async function waitForPhase(phase: RunStatus["phase"], timeoutMs = 25000): Promise<RunStatus> {
  const start = Date.now();
  for (;;) {
    const s = await status();
    if (s.phase === phase) return s;
    if (Date.now() - start > timeoutMs) throw new Error(`never reached phase ${phase}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("content-script run lifecycle", () => {
  let harness: Harness;

  it("runs independently of any popup, rejects duplicate starts, persists the report", { timeout: 30000 }, async () => {
    harness = mountHarness({ catalog: ["Python", "C++", "Python Programming"] });

    expect((await status()).phase).toBe("idle");

    const start = (await send({ type: "skilldock:start", skills: ["Python", "C++", "Node"], speedMode: "slow" })) as { ok: boolean };
    expect(start.ok).toBe(true);

    // Duplicate start while running is rejected.
    const dup = (await send({ type: "skilldock:start", skills: ["Python"], speedMode: "slow" })) as {
      ok: boolean;
      reason?: string;
    };
    expect(dup).toEqual({ ok: false, reason: "already-running" });

    // No popup exists in this test — the run proceeds regardless.
    const finished = await waitForPhase("finished");
    expect(finished.report?.outcome).toBe("completed");
    expect(finished.report?.results).toEqual([
      { skill: "Python", status: "added" },
      { skill: "C++", status: "added" },
      { skill: "Node", status: "no-exact-match" },
    ]);
    expect(harness.selected()).toEqual(["Python", "C++"]);
    expect(stored["lastReport"]).toMatchObject({ outcome: "completed" });
    harness.destroy();
  });

  it("cancels a run via the cancel message", { timeout: 30000 }, async () => {
    harness = mountHarness({ catalog: ["Python", "C++", "Power BI"], suggestDelayMs: 120 });
    const start = (await send({ type: "skilldock:start", skills: ["Python", "C++", "Power BI"], speedMode: "slow" })) as {
      ok: boolean;
    };
    expect(start.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    await send({ type: "skilldock:cancel" });
    const finished = await waitForPhase("finished");
    expect(finished.report?.outcome).toBe("cancelled");
    expect(finished.report?.results.some((r) => r.status === "cancelled")).toBe(true);
    harness.destroy();
  });

  it("reports detection failure with a clear message when no field exists", async () => {
    document.body.innerHTML = "<p>Just a job description mentioning skills.</p>";
    const start = (await send({ type: "skilldock:start", skills: ["Python"], speedMode: "slow" })) as {
      ok: boolean;
      reason?: string;
      detail?: string;
    };
    expect(start.ok).toBe(false);
    expect(start.reason).toBe("detection-failed");
    expect(start.detail).toContain("Skills");
  });
});

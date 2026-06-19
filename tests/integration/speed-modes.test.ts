/**
 * Speed modes must only change how long we wait, never what we check. Each
 * of these proves a reliability guarantee still holds under "fast" — the
 * mode with the most compressed settle delays — using the real presets
 * (no timing overrides), plus a sweep across all three modes for the
 * happy path and cancellation.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mountHarness, type Harness } from "./workday-harness";
import { runFillEngine } from "../../src/fill-engine";
import type { SkillResult, SpeedMode } from "../../src/types";

let harness: Harness | null = null;
afterEach(() => {
  harness?.destroy();
  harness = null;
});

const MODES: SpeedMode[] = ["slow", "medium", "fast"];

function run(
  skills: string[],
  harnessInstance: Harness,
  speedMode: SpeedMode,
  controller = new AbortController(),
): Promise<SkillResult[]> {
  return runFillEngine({
    field: harnessInstance.input,
    skills,
    signal: controller.signal,
    speedMode,
    onProgress: () => undefined,
  });
}

describe("fill engine under every speed mode", () => {
  it.each(MODES)(
    "adds exact matches and reports unmatched skills under %s",
    async (speedMode) => {
      harness = mountHarness({ catalog: ["Python", "Python Programming", "C++"] });
      const results = await run(["Python", "AWS", "C++"], harness, speedMode);
      expect(results.map((r) => r.status)).toEqual(["added", "no-exact-match", "added"]);
      expect(harness.selected()).toEqual(["Python", "C++"]);
    },
    10_000,
  );

  it("never selects a near-miss under fast", async () => {
    harness = mountHarness({ catalog: ["Python Programming", "Amazon Web Services"] });
    const results = await run(["Python", "AWS"], harness, "fast");
    expect(results.map((r) => r.status)).toEqual(["no-exact-match", "no-exact-match"]);
    expect(harness.selected()).toEqual([]);
  });

  it(
    "still reports selection-not-confirmed under fast when the click never takes effect",
    async () => {
      harness = mountHarness({ catalog: ["Python"], swallowSelections: true });
      const results = await run(["Python"], harness, "fast");
      expect(results.map((r) => r.status)).toEqual(["selection-not-confirmed"]);
      expect(harness.selected()).toEqual([]);
    },
    10_000,
  );

  it("still avoids Workday's cached dropdown under fast", async () => {
    harness = mountHarness({
      catalog: ["Apache Airflow", "Database Development", "Python"],
      markup: "menu",
      suggestDelayMs: 120,
    });
    const results = await run(["Apache Airflow", "Database Development", "Python"], harness, "fast");
    expect(results.map((r) => r.status)).toEqual(["added", "added", "added"]);
  });

  it(
    "still reacquires the field after a rerender under fast",
    async () => {
      harness = mountHarness({ catalog: ["Python", "C++"], rerenderAfterSelections: 1 });
      const results = await run(["Python", "C++"], harness, "fast");
      expect(results.map((r) => r.status)).toEqual(["added", "added"]);
    },
    10_000,
  );

  it("still succeeds under fast when suggestions are moderately delayed", async () => {
    harness = mountHarness({ catalog: [".NET"], suggestDelayMs: 1000 });
    const results = await run([".NET"], harness, "fast");
    expect(results.map((r) => r.status)).toEqual(["added"]);
  });

  it.each(MODES)("cancellation marks the remaining skills cancelled under %s", async (speedMode) => {
    harness = mountHarness({ catalog: ["Python", "C++", "Power BI"], suggestDelayMs: 60 });
    const controller = new AbortController();
    const promise = run(["Python", "C++", "Power BI"], harness, speedMode, controller);
    setTimeout(() => controller.abort(), 30);
    const results = await promise;
    expect(results).toHaveLength(3);
    expect(results.some((r) => r.status === "cancelled")).toBe(true);
  });
});

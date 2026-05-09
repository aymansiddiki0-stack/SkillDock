import { afterEach, describe, expect, it } from "vitest";
import { mountHarness, type Harness } from "./workday-harness";
import { runFillEngine } from "../../src/fill-engine";
import type { RunProgress, SkillResult } from "../../src/types";

const FAST = { optionsTimeoutMs: 600, verifyTimeoutMs: 400, betweenSkillsMs: 5 };

let harness: Harness | null = null;
afterEach(() => {
  harness?.destroy();
  harness = null;
});

async function run(
  skills: string[],
  harnessInstance: Harness,
  overrides: Partial<typeof FAST> = {},
  controller = new AbortController(),
  onProgress: (p: RunProgress) => void = () => undefined,
): Promise<SkillResult[]> {
  return runFillEngine({
    field: harnessInstance.input,
    skills,
    signal: controller.signal,
    onProgress,
    timing: { ...FAST, ...overrides },
  });
}

const statusOf = (results: SkillResult[], skill: string) =>
  results.find((r) => r.skill === skill)?.status;

describe("fill engine (integration)", () => {
  it("adds exact matches, skips existing, reports unmatched — and keeps going", async () => {
    harness = mountHarness({
      catalog: ["Python", "Python Programming", "C++", "C#", "Power BI", "JavaScript", "Microsoft SQL Server"],
      preselected: ["C#"],
    });
    const results = await run(["Python", "C#", "AWS", "C++", "Java", "Power BI"], harness);

    expect(statusOf(results, "Python")).toBe("added");
    expect(statusOf(results, "C#")).toBe("already-present");
    expect(statusOf(results, "AWS")).toBe("no-exact-match"); // no options at all
    expect(statusOf(results, "C++")).toBe("added");
    expect(statusOf(results, "Java")).toBe("no-exact-match"); // JavaScript offered, never selected
    expect(statusOf(results, "Power BI")).toBe("added");

    expect(harness.selected()).toEqual(["C#", "Python", "C++", "Power BI"]);
  });

  it("never selects a fuzzy candidate even when it is the only option", async () => {
    harness = mountHarness({ catalog: ["Python Programming", "Node.js", "Amazon Web Services"] });
    const results = await run(["Python", "Node", "AWS"], harness);
    expect(results.map((r) => r.status)).toEqual(["no-exact-match", "no-exact-match", "no-exact-match"]);
    expect(harness.selected()).toEqual([]);
  });

  it("works when the listbox is linked via aria-controls", async () => {
    harness = mountHarness({ catalog: ["Apache Kafka"], ariaLinked: true });
    const results = await run(["Apache Kafka"], harness);
    expect(results).toEqual([{ skill: "Apache Kafka", status: "added" }]);
  });

  it("waits for delayed suggestions instead of failing early", async () => {
    harness = mountHarness({ catalog: [".NET"], suggestDelayMs: 250 });
    const results = await run([".NET"], harness);
    expect(statusOf(results, ".NET")).toBe("added");
  });

  it("times out with a meaningful reason when suggestions never arrive", async () => {
    harness = mountHarness({ catalog: ["Python"], suggestDelayMs: 5_000 });
    const results = await run(["Python"], harness, { optionsTimeoutMs: 200 });
    expect(statusOf(results, "Python")).toBe("timed-out");
    expect(results[0]?.detail).toContain("suggestions");
  });

  it("verifies selection via the chip and tolerates a delayed chip render", async () => {
    harness = mountHarness({ catalog: ["Microsoft SQL Server"], chipDelayMs: 150 });
    const results = await run(["Microsoft SQL Server"], harness);
    expect(statusOf(results, "Microsoft SQL Server")).toBe("added");
    expect(harness.selected()).toEqual(["Microsoft SQL Server"]);
  });

  it("reports selection-not-confirmed when the click never takes effect", async () => {
    harness = mountHarness({ catalog: ["Python"], swallowSelections: true });
    const results = await run(["Python"], harness, { verifyTimeoutMs: 120 });
    expect(statusOf(results, "Python")).toBe("selection-not-confirmed");
    expect(harness.selected()).toEqual([]);
  });

  it("cancels mid-run: remaining skills report cancelled, nothing else is added", async () => {
    harness = mountHarness({ catalog: ["Python", "C++", "Power BI"], suggestDelayMs: 60 });
    const controller = new AbortController();
    const promise = run(["Python", "C++", "Power BI"], harness, {}, controller);
    setTimeout(() => controller.abort(), 120);
    const results = await promise;
    expect(results).toHaveLength(3);
    expect(results.some((r) => r.status === "cancelled")).toBe(true);
    const added = results.filter((r) => r.status === "added").map((r) => r.skill);
    expect(harness.selected()).toEqual(added);
  });

  it("emits monotonic progress updates covering every skill", async () => {
    harness = mountHarness({ catalog: ["Python", "C++"] });
    const updates: RunProgress[] = [];
    await run(["Python", "C++"], harness, {}, new AbortController(), (p) => updates.push(p));
    expect(updates.length).toBeGreaterThanOrEqual(4);
    expect(updates.every((u) => u.total === 2)).toBe(true);
    expect(updates.at(-1)?.completed).toBe(2);
    const completeds = updates.map((u) => u.completed);
    expect([...completeds].sort((a, b) => a - b)).toEqual(completeds);
  });
});

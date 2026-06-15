import { describe, expect, it } from "vitest";
import { TIMING_PRESETS, resolveTiming } from "../../src/fill-engine";
import type { EngineTiming } from "../../src/fill-engine";

const MAX_SAFETY_FIELDS: (keyof EngineTiming)[] = [
  "optionsTimeoutMs",
  "verifyTimeoutMs",
  "reacquireFieldTimeoutMs",
  "staleDropdownCloseTimeoutMs",
];

const SETTLE_FIELDS: (keyof EngineTiming)[] = [
  "betweenSkillsMs",
  "settleAfterTypeMs",
  "settleAfterEnterMs",
  "emptyRecheckMs",
  "typeCommitCheckMs",
  "typeFallbackCharMs",
  "typeFallbackSettleMs",
  "arrowStepDelayMs",
  "pollMs",
];

describe("TIMING_PRESETS", () => {
  it("keeps every max-safety timeout identical across all three modes", () => {
    for (const field of MAX_SAFETY_FIELDS) {
      expect(TIMING_PRESETS.medium[field]).toBe(TIMING_PRESETS.slow[field]);
      expect(TIMING_PRESETS.fast[field]).toBe(TIMING_PRESETS.slow[field]);
    }
  });

  it("strictly shrinks every settle/poll field slow > medium > fast", () => {
    for (const field of SETTLE_FIELDS) {
      expect(TIMING_PRESETS.medium[field]).toBeLessThan(TIMING_PRESETS.slow[field]);
      expect(TIMING_PRESETS.fast[field]).toBeLessThan(TIMING_PRESETS.medium[field]);
    }
  });
});

describe("resolveTiming", () => {
  it("defaults to the slow preset when no speed mode is given", () => {
    expect(resolveTiming(undefined)).toEqual(TIMING_PRESETS.slow);
  });

  it("resolves the preset matching the requested speed mode", () => {
    expect(resolveTiming("fast")).toEqual(TIMING_PRESETS.fast);
    expect(resolveTiming("medium")).toEqual(TIMING_PRESETS.medium);
  });

  it("layers overrides on top of the resolved preset", () => {
    const timing = resolveTiming("fast", { verifyTimeoutMs: 1 });
    expect(timing.verifyTimeoutMs).toBe(1);
    expect(timing.optionsTimeoutMs).toBe(TIMING_PRESETS.fast.optionsTimeoutMs);
  });
});

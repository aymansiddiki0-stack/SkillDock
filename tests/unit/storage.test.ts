import { beforeEach, describe, expect, it } from "vitest";
import {
  createPortfolio,
  deletePortfolio,
  loadPortfolioStore,
  loadSkills,
  loadSpeedMode,
  renamePortfolio,
  saveActivePortfolioSkills,
  saveSpeedMode,
  setActivePortfolio,
} from "../../src/storage";

let backing: Record<string, unknown>;

beforeEach(() => {
  backing = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in backing) out[k] = backing[k];
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(backing, items);
        },
      },
    },
  };
});

describe("portfolio migration", () => {
  it("creates a My Skills portfolio from the legacy skills list", async () => {
    backing["skills"] = ["Python", "C++"];
    const store = await loadPortfolioStore();
    expect(store.portfolios).toHaveLength(1);
    expect(store.portfolios[0]).toMatchObject({ name: "My Skills", skills: ["Python", "C++"] });
    expect(store.activePortfolioId).toBe(store.portfolios[0]!.id);
  });

  it("never produces zero portfolios when nothing is saved yet", async () => {
    const store = await loadPortfolioStore();
    expect(store.portfolios).toHaveLength(1);
    expect(store.portfolios[0]!.skills).toEqual([]);
  });

  it("is idempotent across repeated loads", async () => {
    backing["skills"] = ["Python"];
    const first = await loadPortfolioStore();
    const second = await loadPortfolioStore();
    expect(second).toEqual(first);
  });

  it("never deletes the legacy skills key", async () => {
    backing["skills"] = ["Python"];
    await loadPortfolioStore();
    expect(backing["skills"]).toEqual(["Python"]);
  });

  it("self-heals a corrupted activePortfolioId instead of re-migrating", async () => {
    backing["portfolios"] = {
      schemaVersion: 1,
      portfolios: [{ id: "a", name: "Data", skills: ["SQL"] }],
      activePortfolioId: "does-not-exist",
    };
    const store = await loadPortfolioStore();
    expect(store.activePortfolioId).toBe("a");
    expect(store.portfolios).toHaveLength(1);
  });
});

describe("portfolio CRUD", () => {
  it("creates a portfolio and makes it active", async () => {
    const store = await createPortfolio("AI / ML");
    expect(store.portfolios.map((p) => p.name)).toEqual(["My Skills", "AI / ML"]);
    expect(store.activePortfolioId).toBe(store.portfolios[1]!.id);
    expect(await loadPortfolioStore()).toEqual(store);
  });

  it("renames a portfolio without touching its id or skills", async () => {
    const before = await loadPortfolioStore();
    const id = before.portfolios[0]!.id;
    const store = await renamePortfolio(id, "Renamed");
    expect(store.portfolios[0]).toEqual({ ...before.portfolios[0], name: "Renamed" });
  });

  it("keeps skills isolated per portfolio", async () => {
    const first = await loadPortfolioStore();
    const myId = first.portfolios[0]!.id;
    await saveActivePortfolioSkills(["Python"]);

    const created = await createPortfolio("AI / ML");
    const aiId = created.portfolios[1]!.id;
    await saveActivePortfolioSkills(["TensorFlow"]);

    await setActivePortfolio(myId);
    const back = await loadPortfolioStore();
    expect(back.portfolios.find((p) => p.id === myId)!.skills).toEqual(["Python"]);
    expect(back.portfolios.find((p) => p.id === aiId)!.skills).toEqual(["TensorFlow"]);
  });

  it("reassigns the active portfolio when the active one is deleted", async () => {
    const first = await loadPortfolioStore();
    const myId = first.portfolios[0]!.id;
    const created = await createPortfolio("AI / ML"); // now active
    const aiId = created.portfolios[1]!.id;

    const store = await deletePortfolio(aiId);
    expect(store.portfolios.map((p) => p.id)).toEqual([myId]);
    expect(store.activePortfolioId).toBe(myId);
  });

  it("refuses to delete the last remaining portfolio", async () => {
    const before = await loadPortfolioStore();
    const store = await deletePortfolio(before.portfolios[0]!.id);
    expect(store).toEqual(before);
  });

  it("persists across a simulated popup reopen", async () => {
    const store = await createPortfolio("Analytics");
    expect(await loadPortfolioStore()).toEqual(store);
  });
});

describe("speed mode", () => {
  it("defaults to slow when nothing is saved", async () => {
    expect(await loadSpeedMode()).toBe("slow");
  });

  it("round-trips a saved value", async () => {
    await saveSpeedMode("fast");
    expect(await loadSpeedMode()).toBe("fast");
  });

  it("falls back to slow for a malformed stored value", async () => {
    backing["speedMode"] = "turbo";
    expect(await loadSpeedMode()).toBe("slow");
  });
});

describe("legacy skills accessor (regression)", () => {
  it("coerces malformed/missing data to an empty list", async () => {
    expect(await loadSkills()).toEqual([]);
    backing["skills"] = "not an array";
    expect(await loadSkills()).toEqual([]);
  });
});

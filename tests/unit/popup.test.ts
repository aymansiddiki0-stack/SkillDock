import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const popupHtmlPath = resolve(__dirname, "../../src/popup/popup.html");
const bodyHtml = readFileSync(popupHtmlPath, "utf-8")
  .match(/<body>([\s\S]*)<\/body>/)![1]!
  .replace(/<script[\s\S]*?<\/script>/, ""); // built popup.js does not exist as a fetchable file in this test

let backing: Record<string, unknown>;
let sentMessages: unknown[];
let tabResponse: unknown;

function setChromeMock(): void {
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
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (_tabId: number, message: unknown) => {
        sentMessages.push(message);
        return tabResponse;
      },
    },
    scripting: {
      executeScript: async () => undefined,
    },
  };
}

async function loadPopup() {
  document.body.innerHTML = bodyHtml;
  vi.resetModules();
  return import("../../src/popup/popup");
}

beforeEach(() => {
  backing = {};
  sentMessages = [];
  tabResponse = { status: { phase: "idle" } };
  setChromeMock();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("popup portfolios", () => {
  it("renders every portfolio and selects the active one", async () => {
    backing["portfolios"] = {
      schemaVersion: 1,
      portfolios: [
        { id: "a", name: "My Skills", skills: ["Python"] },
        { id: "b", name: "AI / ML", skills: ["TensorFlow"] },
      ],
      activePortfolioId: "b",
    };
    const popup = await loadPopup();
    await popup.init();

    const select = document.getElementById("portfolio-select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["My Skills", "AI / ML"]);
    expect(select.value).toBe("b");
    expect((document.getElementById("skills-input") as HTMLTextAreaElement).value).toBe("TensorFlow");
  });

  it("loads the right skills when switching portfolios", async () => {
    backing["portfolios"] = {
      schemaVersion: 1,
      portfolios: [
        { id: "a", name: "My Skills", skills: ["Python"] },
        { id: "b", name: "AI / ML", skills: ["TensorFlow"] },
      ],
      activePortfolioId: "a",
    };
    const popup = await loadPopup();
    await popup.init();

    const select = document.getElementById("portfolio-select") as HTMLSelectElement;
    select.value = "b";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect((document.getElementById("skills-input") as HTMLTextAreaElement).value).toBe("TensorFlow");
    });
  });

  it("creates a new portfolio via the inline New input", async () => {
    const popup = await loadPopup();
    await popup.init();

    const select = document.getElementById("portfolio-select") as HTMLSelectElement;
    const nameInput = document.getElementById("portfolio-name-input") as HTMLInputElement;
    (document.getElementById("portfolio-new-btn") as HTMLButtonElement).click();
    expect(select.hidden).toBe(true);
    expect(nameInput.hidden).toBe(false);

    nameInput.value = "Analytics";
    nameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    await vi.waitFor(() => {
      expect([...select.options].map((o) => o.textContent)).toEqual(["My Skills", "Analytics"]);
    });
    expect(select.value).not.toBe("");
    expect((document.getElementById("skills-input") as HTMLTextAreaElement).value).toBe("");
    expect(nameInput.hidden).toBe(true);
  });

  it("cancels the inline edit on Escape without changing anything", async () => {
    const popup = await loadPopup();
    await popup.init();

    const select = document.getElementById("portfolio-select") as HTMLSelectElement;
    const nameInput = document.getElementById("portfolio-name-input") as HTMLInputElement;
    (document.getElementById("portfolio-rename-btn") as HTMLButtonElement).click();
    nameInput.value = "Something Else";
    nameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(nameInput.hidden).toBe(true);
    expect(select.hidden).toBe(false);
    expect([...select.options].map((o) => o.textContent)).toEqual(["My Skills"]);
  });

  it("renames the active portfolio without changing its id or skills", async () => {
    backing["portfolios"] = {
      schemaVersion: 1,
      portfolios: [{ id: "a", name: "My Skills", skills: ["Python"] }],
      activePortfolioId: "a",
    };
    const popup = await loadPopup();
    await popup.init();

    const nameInput = document.getElementById("portfolio-name-input") as HTMLInputElement;
    (document.getElementById("portfolio-rename-btn") as HTMLButtonElement).click();
    expect(nameInput.value).toBe("My Skills");
    nameInput.value = "Renamed";
    nameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    await vi.waitFor(() => {
      const store = backing["portfolios"] as { portfolios: { id: string; name: string; skills: string[] }[] };
      expect(store.portfolios).toEqual([{ id: "a", name: "Renamed", skills: ["Python"] }]);
    });
  });

  it("disables Delete with one portfolio and removes the active one with two", async () => {
    const popup = await loadPopup();
    await popup.init();
    const deleteBtn = document.getElementById("portfolio-delete-btn") as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);

    const select = document.getElementById("portfolio-select") as HTMLSelectElement;
    (document.getElementById("portfolio-new-btn") as HTMLButtonElement).click();
    const nameInput = document.getElementById("portfolio-name-input") as HTMLInputElement;
    nameInput.value = "Analytics";
    nameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(deleteBtn.disabled).toBe(false));

    deleteBtn.click();
    await vi.waitFor(() => {
      expect([...select.options].map((o) => o.textContent)).toEqual(["My Skills"]);
    });
    expect(deleteBtn.disabled).toBe(true);
  });

  it("keeps saved skills isolated between portfolios", async () => {
    backing["portfolios"] = {
      schemaVersion: 1,
      portfolios: [
        { id: "a", name: "My Skills", skills: [] },
        { id: "b", name: "AI / ML", skills: [] },
      ],
      activePortfolioId: "a",
    };
    const popup = await loadPopup();
    await popup.init();

    const select = document.getElementById("portfolio-select") as HTMLSelectElement;
    const skillsInput = document.getElementById("skills-input") as HTMLTextAreaElement;
    skillsInput.value = "Python";
    (document.getElementById("save-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      const store = backing["portfolios"] as { portfolios: { id: string; skills: string[] }[] };
      expect(store.portfolios.find((p) => p.id === "a")!.skills).toEqual(["Python"]);
    });

    select.value = "b";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(skillsInput.value).toBe(""));
    skillsInput.value = "TensorFlow";
    (document.getElementById("save-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      const store = backing["portfolios"] as { portfolios: { id: string; skills: string[] }[] };
      expect(store.portfolios.find((p) => p.id === "b")!.skills).toEqual(["TensorFlow"]);
      expect(store.portfolios.find((p) => p.id === "a")!.skills).toEqual(["Python"]);
    });
  });
});

describe("popup speed selector", () => {
  it("initializes from storage and persists on change", async () => {
    backing["speedMode"] = "fast";
    const popup = await loadPopup();
    await popup.init();
    const select = document.getElementById("speed-select") as HTMLSelectElement;
    expect(select.value).toBe("fast");

    select.value = "medium";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(backing["speedMode"]).toBe("medium"));
  });

  it("includes the selected speed mode in the start message", async () => {
    backing["portfolios"] = {
      schemaVersion: 1,
      portfolios: [{ id: "a", name: "My Skills", skills: ["Python"] }],
      activePortfolioId: "a",
    };
    tabResponse = { ok: true };
    const popup = await loadPopup();
    await popup.init();

    const select = document.getElementById("speed-select") as HTMLSelectElement;
    select.value = "fast";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(backing["speedMode"]).toBe("fast"));

    (document.getElementById("fill-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(sentMessages).toContainEqual({ type: "skilldock:start", skills: ["Python"], speedMode: "fast" });
    });
  });
});

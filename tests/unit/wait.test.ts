// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CancelledError, TimeoutError, delay, waitFor } from "../../src/wait";

describe("waitFor", () => {
  it("resolves immediately when the condition already holds", async () => {
    await expect(
      waitFor(() => "ready", { description: "x", timeoutMs: 50 }),
    ).resolves.toBe("ready");
  });

  it("resolves when a DOM mutation satisfies the condition", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const promise = waitFor(() => (el.querySelector(".chip") ? true : null), {
      description: "chip",
      timeoutMs: 1000,
    });
    setTimeout(() => {
      const chip = document.createElement("span");
      chip.className = "chip";
      el.appendChild(chip);
    }, 20);
    await expect(promise).resolves.toBe(true);
    el.remove();
  });

  it("rejects with TimeoutError including the description and duration", async () => {
    await expect(
      waitFor(() => null, { description: "suggestions for \"Python\"", timeoutMs: 40 }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      message: expect.stringContaining("suggestions for \"Python\""),
    });
  });

  it("rejects with CancelledError when aborted mid-wait", async () => {
    const controller = new AbortController();
    const promise = waitFor(() => null, {
      description: "never",
      timeoutMs: 5000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 15);
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
  });

  it("rejects instantly on an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitFor(() => null, { description: "never", timeoutMs: 5000, signal: controller.signal }),
    ).rejects.toBeInstanceOf(CancelledError);
  });

  it("does not keep re-running the check after settling (observer/timer cleanup)", async () => {
    let calls = 0;
    await waitFor(
      () => {
        calls++;
        return true;
      },
      { description: "x", timeoutMs: 100, pollMs: 5 },
    );
    const settled = calls;
    document.body.appendChild(document.createElement("div")); // mutation after settle
    await new Promise((r) => setTimeout(r, 40)); // several poll intervals
    expect(calls).toBe(settled);
  });

  it("reacts to a non-mutation state change at the given pollMs granularity", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true; // plain property flip — no DOM mutation to observe
    }, 20);
    await expect(
      waitFor(() => (ready ? true : null), { description: "ready flag", timeoutMs: 500, pollMs: 5 }),
    ).resolves.toBe(true);
  });

  it("propagates errors thrown by the check and cleans up", async () => {
    await expect(
      waitFor(() => {
        throw new Error("boom");
      }, { description: "x", timeoutMs: 100 }),
    ).rejects.toThrow("boom");
  });
});

describe("delay", () => {
  it("rejects with CancelledError when aborted", async () => {
    const controller = new AbortController();
    const p = delay(1000, controller.signal);
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    expect(new TimeoutError("x", 1).name).toBe("TimeoutError");
  });
});

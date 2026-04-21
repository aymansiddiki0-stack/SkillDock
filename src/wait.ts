/**
 * Bounded, cancellable waiting.
 *
 * Synchronization is driven by observable page state: a MutationObserver
 * re-runs the check whenever the DOM changes, with a low-frequency interval
 * as a safety net for state changes that produce no mutation (e.g. a
 * controlled input's `value` property). Every wait has a timeout and cancels
 * on an AbortSignal.
 */

export class TimeoutError extends Error {
  constructor(description: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    this.name = "TimeoutError";
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export interface WaitOptions {
  /** Human-readable description used in the timeout message. */
  description: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Node observed for mutations. Defaults to the whole document. */
  root?: Node;
  /** Safety-net polling interval for non-mutation state changes. */
  pollMs?: number;
}

export function waitFor<T>(check: () => T | null, opts: WaitOptions): Promise<T> {
  const { description, timeoutMs, signal, pollMs = 150 } = opts;
  const root = opts.root ?? document.documentElement;

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }

    let observer: MutationObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let settled = false;

    const cleanup = () => {
      settled = true;
      observer?.disconnect();
      observer = null;
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (intervalId !== null) clearInterval(intervalId);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      cleanup();
      reject(new CancelledError());
    };

    const attempt = () => {
      if (settled) return;
      let value: T | null;
      try {
        value = check();
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      if (value !== null) {
        cleanup();
        resolve(value);
      }
    };

    // Immediate check — the condition may already hold.
    attempt();
    if (settled) return;

    signal?.addEventListener("abort", onAbort);

    observer = new MutationObserver(attempt);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    intervalId = setInterval(attempt, pollMs);
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new TimeoutError(description, timeoutMs));
    }, timeoutMs);
  });
}

/** Cancellable delay. Rejects with CancelledError when the signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new CancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

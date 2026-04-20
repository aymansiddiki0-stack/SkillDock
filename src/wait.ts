/**
 * Bounded waiting driven by observable page state: a MutationObserver re-runs
 * the check whenever the DOM changes, with a low-frequency interval as a
 * safety net for state changes that produce no mutation (e.g. a controlled
 * input's `value` property).
 *
 * Polling alone meant a 100ms floor on every dropdown read; Workday renders
 * suggestions in one burst, so reacting to the mutation is both faster and
 * cheaper.
 */

export class TimeoutError extends Error {
  constructor(description: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    this.name = "TimeoutError";
  }
}

export interface WaitOptions {
  /** Human-readable description used in the timeout message. */
  description: string;
  timeoutMs: number;
  /** Node observed for mutations. Defaults to the whole document. */
  root?: Node;
  /** Safety-net polling interval for non-mutation state changes. */
  pollMs?: number;
}

export function waitFor<T>(check: () => T | null, opts: WaitOptions): Promise<T> {
  const { description, timeoutMs, pollMs = 150 } = opts;
  const root = opts.root ?? document.documentElement;

  return new Promise<T>((resolve, reject) => {
    let observer: MutationObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      observer?.disconnect();
      observer = null;
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (intervalId !== null) clearInterval(intervalId);
    };

    const attempt = () => {
      const value = check();
      if (value !== null) {
        cleanup();
        resolve(value);
      }
    };

    // Immediate check — the condition may already hold.
    attempt();

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

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

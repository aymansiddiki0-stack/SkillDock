export class TimeoutError extends Error {
  constructor(description: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    this.name = "TimeoutError";
  }
}

export interface WaitOptions {
  description: string;
  timeoutMs: number;
  pollMs?: number;
}

/** Poll `check` until it returns a non-null value, or time out. */
export function waitFor<T>(check: () => T | null, opts: WaitOptions): Promise<T> {
  const { description, timeoutMs, pollMs = 100 } = opts;
  const started = Date.now();

  return new Promise<T>((resolve, reject) => {
    const tick = () => {
      const value = check();
      if (value !== null) {
        resolve(value);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new TimeoutError(description, timeoutMs));
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

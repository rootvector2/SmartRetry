/**
 * Calculates the exponential backoff delay for a given retry attempt.
 *
 * The formula is: `min(maxDelayMs, baseDelayMs * 2^attempt)`
 *
 * Overflow is protected by clamping to `maxDelayMs`.
 *
 * @param attempt - The retry attempt index (0-based; 0 = first retry).
 * @param baseDelayMs - The base delay in milliseconds.
 * @param maxDelayMs - The maximum delay in milliseconds.
 * @returns The computed backoff delay in milliseconds.
 *
 * @example
 * ```ts
 * calculateBackoffDelay(0, 300, 5000); // 300
 * calculateBackoffDelay(1, 300, 5000); // 600
 * calculateBackoffDelay(4, 300, 5000); // 4800
 * calculateBackoffDelay(5, 300, 5000); // 5000 (clamped)
 * ```
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  // Guard against overflow: if the exponent would produce Infinity or a
  // value larger than maxDelayMs, clamp early.
  const exp = Math.pow(2, attempt);
  const delay = baseDelayMs * exp;

  // If delay is NaN or Infinity (overflow), clamp to maxDelayMs.
  if (!Number.isFinite(delay)) {
    return maxDelayMs;
  }

  return Math.min(maxDelayMs, delay);
}

/**
 * Applies full jitter to a computed delay value.
 *
 * Full jitter returns a random value in the range `[0, delay)`.
 *
 * @param delay - The computed backoff delay in milliseconds.
 * @returns A jittered delay between 0 (inclusive) and `delay` (exclusive).
 *
 * @example
 * ```ts
 * const jittered = applyJitter(1000); // e.g., 423
 * ```
 */
export function applyJitter(delay: number): number {
  return Math.random() * delay;
}

/**
 * Sleeps for the specified duration in milliseconds.
 *
 * Supports an optional `AbortSignal` for cancellation. If the signal is
 * aborted during sleep, the returned promise rejects with the signal's reason
 * (or a default `DOMException`).
 *
 * Listeners are properly cleaned up to avoid memory leaks.
 *
 * @param ms - Duration to sleep in milliseconds.
 * @param signal - Optional `AbortSignal` for cancellation.
 * @returns A promise that resolves after `ms` milliseconds, or rejects if aborted.
 *
 * @throws {DOMException} If the signal is aborted during sleep.
 *
 * @example
 * ```ts
 * await sleep(1000); // waits 1 second
 *
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 500);
 * await sleep(2000, controller.signal); // rejects after ~500ms
 * ```
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    let timerId: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    const cleanup = (): void => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
        timerId = undefined;
      }
      if (onAbort && signal) {
        signal.removeEventListener("abort", onAbort);
        onAbort = undefined;
      }
    };

    timerId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (signal) {
      onAbort = () => {
        cleanup();
        reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Network error codes commonly encountered in Node.js that indicate
 * transient connectivity issues and are safe to retry.
 */
const RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/**
 * Determines whether the given error is a transient network error
 * that is safe to retry.
 *
 * Checks the `code` property of the error against known retryable
 * network error codes: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`.
 *
 * @param error - The error to inspect.
 * @returns `true` if the error is a retryable network error.
 *
 * @example
 * ```ts
 * try {
 *   await fetch("https://example.com");
 * } catch (err) {
 *   if (isNetworkError(err)) {
 *     // safe to retry
 *   }
 * }
 * ```
 */
export function isNetworkError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  if (typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") {
      return RETRYABLE_NETWORK_CODES.has(code);
    }
  }

  return false;
}

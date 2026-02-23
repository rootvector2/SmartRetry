import type { RetryOptions } from "./types.js";
import { AbortError, RetryExhaustedError, TimeoutError } from "./errors.js";
import { defaultRetryPolicy } from "./policies.js";
import { applyJitter, calculateBackoffDelay, sleep } from "./utils.js";

/**
 * Default values for {@link RetryOptions}.
 */
const DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 300,
  maxDelayMs: 5000,
  jitter: true,
} as const;

/**
 * Validates the provided retry options and throws descriptive errors
 * for any invalid configuration.
 *
 * @param options - The options to validate.
 * @throws {Error} If any option value is invalid.
 */
function validateOptions(options: RetryOptions): void {
  const { maxRetries, baseDelayMs, maxDelayMs, timeoutMs } = options;

  if (maxRetries !== undefined && maxRetries < 0) {
    throw new Error(`smartRetry: maxRetries must be >= 0, received ${maxRetries}`);
  }

  if (baseDelayMs !== undefined && baseDelayMs <= 0) {
    throw new Error(`smartRetry: baseDelayMs must be > 0, received ${baseDelayMs}`);
  }

  const effectiveBaseDelay = baseDelayMs ?? DEFAULTS.baseDelayMs;
  if (maxDelayMs !== undefined && maxDelayMs < effectiveBaseDelay) {
    throw new Error(
      `smartRetry: maxDelayMs (${maxDelayMs}) must be >= baseDelayMs (${effectiveBaseDelay})`,
    );
  }

  if (timeoutMs !== undefined && timeoutMs <= 0) {
    throw new Error(`smartRetry: timeoutMs must be > 0, received ${timeoutMs}`);
  }
}

/**
 * Wraps an async function and retries it with intelligent retry logic
 * including exponential backoff, jitter, timeout, and abort support.
 *
 * The `fn` function receives the current `attempt` index (0 for the initial
 * call, 1 for the first retry, etc.). Total execution attempts = `1 + maxRetries`.
 *
 * @typeParam T - The resolved type of the wrapped async function.
 * @param fn - The async function to execute. Receives the current attempt index.
 * @param options - Optional retry configuration.
 * @returns The resolved value of `fn` on success.
 *
 * @throws {TimeoutError} If the global `timeoutMs` is exceeded.
 * @throws {AbortError} If the provided `AbortSignal` is aborted.
 * @throws {RetryExhaustedError} If all retries are exhausted.
 *
 * @example
 * ```ts
 * import { smartRetry } from "smart-retry";
 *
 * const result = await smartRetry(
 *   async (attempt) => {
 *     const res = await fetch("https://api.example.com/data");
 *     if (!res.ok) {
 *       const err: any = new Error("Request failed");
 *       err.status = res.status;
 *       throw err;
 *     }
 *     return res.json();
 *   },
 *   {
 *     maxRetries: 5,
 *     baseDelayMs: 200,
 *     timeoutMs: 10000,
 *   }
 * );
 * ```
 */
export async function smartRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  validateOptions(options);

  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const jitter = options.jitter ?? DEFAULTS.jitter;
  const retryOn = options.retryOn ?? defaultRetryPolicy;
  const onRetry = options.onRetry;
  const timeoutMs = options.timeoutMs;
  const signal = options.signal;

  const startTime = Date.now();

  // Check if already aborted
  if (signal?.aborted) {
    throw new AbortError(
      { totalAttempts: 0, totalElapsedMs: 0 },
      { cause: signal.reason },
    );
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check timeout before each attempt
    if (timeoutMs !== undefined) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        throw new TimeoutError(
          { totalAttempts: attempt, totalElapsedMs: elapsed },
          { cause: lastError },
        );
      }
    }

    // Check abort before each attempt
    if (signal?.aborted) {
      throw new AbortError(
        { totalAttempts: attempt, totalElapsedMs: Date.now() - startTime },
        { cause: signal.reason },
      );
    }

    try {
      const result = await fn(attempt);
      return result;
    } catch (error: unknown) {
      lastError = error;

      // If this was the last possible attempt, break to throw RetryExhaustedError
      if (attempt >= maxRetries) {
        break;
      }

      // Check if the error is retryable — if not, rethrow immediately
      if (!retryOn(error, attempt)) {
        throw error;
      }

      // Check timeout before sleeping
      if (timeoutMs !== undefined) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
          throw new TimeoutError(
            { totalAttempts: attempt + 1, totalElapsedMs: elapsed },
            { cause: error },
          );
        }
      }

      // Check abort before sleeping
      if (signal?.aborted) {
        throw new AbortError(
          { totalAttempts: attempt + 1, totalElapsedMs: Date.now() - startTime },
          { cause: signal.reason },
        );
      }

      // Calculate delay for this retry
      // Retry index is 0 for the first retry (after attempt 0 fails)
      const retryIndex = attempt;
      let delay = calculateBackoffDelay(retryIndex, baseDelayMs, maxDelayMs);

      if (jitter) {
        delay = applyJitter(delay);
      }

      // Clamp delay so we don't sleep past the timeout
      if (timeoutMs !== undefined) {
        const elapsed = Date.now() - startTime;
        const remaining = timeoutMs - elapsed;
        if (remaining <= 0) {
          throw new TimeoutError(
            { totalAttempts: attempt + 1, totalElapsedMs: elapsed },
            { cause: error },
          );
        }
        delay = Math.min(delay, remaining);
      }

      // Notify onRetry callback
      if (onRetry) {
        onRetry(error, attempt + 1, delay);
      }

      // Sleep with abort support
      try {
        await sleep(delay, signal);
      } catch {
        // Sleep was aborted
        if (signal?.aborted) {
          throw new AbortError(
            { totalAttempts: attempt + 1, totalElapsedMs: Date.now() - startTime },
            { cause: signal.reason },
          );
        }
        throw new AbortError(
          { totalAttempts: attempt + 1, totalElapsedMs: Date.now() - startTime },
          { cause: lastError },
        );
      }
    }
  }

  // All retries exhausted
  const totalElapsedMs = Date.now() - startTime;
  throw new RetryExhaustedError(
    { totalAttempts: maxRetries + 1, totalElapsedMs },
    { cause: lastError },
  );
}

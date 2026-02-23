import type { RetryErrorMetadata } from "./types.js";

/**
 * Base error class for all SmartRetry errors.
 * Extends the native `Error` with retry metadata.
 */
export class SmartRetryError extends Error {
  /** Total number of attempts made (initial + retries). */
  public readonly totalAttempts: number;
  /** Total elapsed time in milliseconds from start to failure. */
  public readonly totalElapsedMs: number;

  constructor(message: string, metadata: RetryErrorMetadata, options?: ErrorOptions) {
    super(message, options);
    this.name = "SmartRetryError";
    this.totalAttempts = metadata.totalAttempts;
    this.totalElapsedMs = metadata.totalElapsedMs;
  }
}

/**
 * Thrown when the global timeout (`timeoutMs`) is exceeded across all attempts.
 *
 * @example
 * ```ts
 * try {
 *   await smartRetry(fn, { timeoutMs: 5000 });
 * } catch (err) {
 *   if (err instanceof TimeoutError) {
 *     console.log(`Timed out after ${err.totalElapsedMs}ms`);
 *   }
 * }
 * ```
 */
export class TimeoutError extends SmartRetryError {
  constructor(metadata: RetryErrorMetadata, options?: ErrorOptions) {
    super(
      `SmartRetry timed out after ${metadata.totalElapsedMs}ms (${metadata.totalAttempts} attempt(s))`,
      metadata,
      options,
    );
    this.name = "TimeoutError";
  }
}

/**
 * Thrown when the operation is aborted via an `AbortSignal`.
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 * try {
 *   await smartRetry(fn, { signal: controller.signal });
 * } catch (err) {
 *   if (err instanceof AbortError) {
 *     console.log("Operation was aborted");
 *   }
 * }
 * ```
 */
export class AbortError extends SmartRetryError {
  constructor(metadata: RetryErrorMetadata, options?: ErrorOptions) {
    super(
      `SmartRetry aborted after ${metadata.totalElapsedMs}ms (${metadata.totalAttempts} attempt(s))`,
      metadata,
      options,
    );
    this.name = "AbortError";
  }
}

/**
 * Thrown when all retry attempts have been exhausted without success.
 * The original error is available via the `.cause` property.
 *
 * @example
 * ```ts
 * try {
 *   await smartRetry(fn, { maxRetries: 3 });
 * } catch (err) {
 *   if (err instanceof RetryExhaustedError) {
 *     console.log(`Failed after ${err.totalAttempts} attempts`);
 *     console.log("Last error:", err.cause);
 *   }
 * }
 * ```
 */
export class RetryExhaustedError extends SmartRetryError {
  constructor(metadata: RetryErrorMetadata, options?: ErrorOptions) {
    super(
      `SmartRetry exhausted after ${metadata.totalAttempts} attempt(s) over ${metadata.totalElapsedMs}ms`,
      metadata,
      options,
    );
    this.name = "RetryExhaustedError";
  }
}

/**
 * Configuration options for the {@link smartRetry} function.
 *
 * @example
 * ```ts
 * const options: RetryOptions = {
 *   maxRetries: 5,
 *   baseDelayMs: 200,
 *   maxDelayMs: 10000,
 *   jitter: true,
 *   timeoutMs: 30000,
 * };
 * ```
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts after the initial execution.
   * Total attempts = 1 + maxRetries.
   *
   * @default 3
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds for exponential backoff calculation.
   * The actual delay is computed as `min(maxDelayMs, baseDelayMs * 2^attempt)`.
   *
   * @default 300
   */
  baseDelayMs?: number;

  /**
   * Maximum delay in milliseconds. The computed backoff delay is clamped to
   * this value to prevent excessively long wait times.
   *
   * @default 5000
   */
  maxDelayMs?: number;

  /**
   * Whether to apply full jitter to the computed delay.
   * When `true`, the actual delay is `random(0, computedDelay)`.
   * When `false`, the computed delay is used as-is.
   *
   * @default true
   */
  jitter?: boolean;

  /**
   * A predicate that determines whether a given error should trigger a retry.
   * Return `true` to retry, `false` to stop immediately and rethrow.
   *
   * If not provided, the default policy retries on network errors and
   * retryable HTTP status codes (429, 500–599).
   *
   * @param error - The error thrown by the wrapped function.
   * @param attempt - The current attempt index (0-based from the initial call).
   * @returns Whether the error is retryable.
   */
  retryOn?: (error: unknown, attempt: number) => boolean;

  /**
   * A callback invoked before each retry attempt. Useful for logging or metrics.
   *
   * @param error - The error that triggered the retry.
   * @param attempt - The upcoming retry attempt index.
   * @param delay - The delay in milliseconds before the retry executes.
   */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;

  /**
   * Total timeout in milliseconds across ALL attempts.
   * If the elapsed time exceeds this value, a {@link TimeoutError} is thrown
   * and no further retries are attempted.
   *
   * This is a global timeout, not per-attempt.
   */
  timeoutMs?: number;

  /**
   * An optional `AbortSignal` for cancellation support.
   * If the signal is already aborted, the function throws immediately.
   * If aborted during a retry delay or execution, the operation is cancelled.
   */
  signal?: AbortSignal;
}

/**
 * Metadata attached to retry-related errors.
 */
export interface RetryErrorMetadata {
  /** Total number of attempts made (initial + retries). */
  totalAttempts: number;
  /** Total elapsed time in milliseconds from start to failure. */
  totalElapsedMs: number;
}

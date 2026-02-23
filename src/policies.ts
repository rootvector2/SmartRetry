import { isNetworkError } from "./utils.js";

/**
 * Extracts an HTTP status code from a loosely-typed error object.
 *
 * Checks the following patterns in order:
 * 1. `error.status` (e.g., Axios, custom errors)
 * 2. `error.response?.status` (e.g., Axios response errors)
 *
 * @param error - The error to extract the status from.
 * @returns The HTTP status code, or `undefined` if none is found.
 */
function extractHttpStatus(error: unknown): number | undefined {
  if (error === null || error === undefined || typeof error !== "object") {
    return undefined;
  }

  // Check error.status
  if ("status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number" && Number.isInteger(status)) {
      return status;
    }
  }

  // Check error.response?.status
  if ("response" in error) {
    const response = (error as { response: unknown }).response;
    if (response !== null && response !== undefined && typeof response === "object" && "status" in response) {
      const status = (response as { status: unknown }).status;
      if (typeof status === "number" && Number.isInteger(status)) {
        return status;
      }
    }
  }

  return undefined;
}

/**
 * Determines whether an error represents a retryable HTTP error.
 *
 * Retryable HTTP status codes:
 * - **429** (Too Many Requests)
 * - **500–599** (Server errors)
 *
 * Non-retryable:
 * - **400–499** (Client errors, except 429)
 *
 * The status is extracted from `error.status` or `error.response?.status`.
 *
 * @param error - The error to inspect.
 * @returns `true` if the HTTP status code indicates a retryable error.
 *
 * @example
 * ```ts
 * const err: any = new Error("Server Error");
 * err.status = 503;
 * isRetryableHttpError(err); // true
 *
 * const err2: any = new Error("Bad Request");
 * err2.status = 400;
 * isRetryableHttpError(err2); // false
 * ```
 */
export function isRetryableHttpError(error: unknown): boolean {
  const status = extractHttpStatus(error);
  if (status === undefined) {
    return false;
  }

  // 429 Too Many Requests is retryable
  if (status === 429) {
    return true;
  }

  // 500–599 Server errors are retryable
  if (status >= 500 && status <= 599) {
    return true;
  }

  return false;
}

/**
 * The default retry policy used when no `retryOn` predicate is provided.
 *
 * Retries on:
 * - Network errors: `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`
 * - HTTP 429 (Too Many Requests)
 * - HTTP 500–599 (Server errors)
 *
 * Does **not** retry on:
 * - HTTP 400–499 (Client errors, except 429)
 * - Any other error without a recognized code or status
 *
 * If the error has no recognizable HTTP status or network code, it is
 * considered retryable by default (e.g., generic `TypeError` from `fetch`).
 *
 * @param error - The error to evaluate.
 * @returns `true` if the error should be retried.
 */
export function defaultRetryPolicy(error: unknown): boolean {
  // Network errors are always retryable
  if (isNetworkError(error)) {
    return true;
  }

  // Check HTTP status
  const status = extractHttpStatus(error);
  if (status !== undefined) {
    // 429 is retryable
    if (status === 429) {
      return true;
    }
    // 500-599 are retryable
    if (status >= 500 && status <= 599) {
      return true;
    }
    // 400-499 (except 429) are NOT retryable
    if (status >= 400 && status <= 499) {
      return false;
    }
  }

  // For errors without a recognized status or code, retry by default.
  // This handles generic errors like TypeError from fetch failures.
  return true;
}

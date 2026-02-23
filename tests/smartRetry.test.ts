import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { smartRetry } from "../src/smartRetry.js";
import { defaultRetryPolicy, isRetryableHttpError } from "../src/policies.js";
import { calculateBackoffDelay, applyJitter, isNetworkError } from "../src/utils.js";
import {
  RetryExhaustedError,
  TimeoutError,
  AbortError,
  SmartRetryError,
} from "../src/errors.js";

// ---------------------------------------------------------------------------
// Utility: calculateBackoffDelay
// ---------------------------------------------------------------------------

describe("calculateBackoffDelay", () => {
  it("returns baseDelayMs for attempt 0", () => {
    expect(calculateBackoffDelay(0, 300, 5000)).toBe(300);
  });

  it("doubles on each attempt", () => {
    expect(calculateBackoffDelay(1, 300, 5000)).toBe(600);
    expect(calculateBackoffDelay(2, 300, 5000)).toBe(1200);
    expect(calculateBackoffDelay(3, 300, 5000)).toBe(2400);
  });

  it("clamps to maxDelayMs", () => {
    expect(calculateBackoffDelay(5, 300, 5000)).toBe(5000);
    expect(calculateBackoffDelay(10, 300, 5000)).toBe(5000);
  });

  it("handles overflow safely", () => {
    expect(calculateBackoffDelay(1024, 300, 5000)).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Utility: applyJitter
// ---------------------------------------------------------------------------

describe("applyJitter", () => {
  it("produces a value within [0, delay)", () => {
    for (let i = 0; i < 100; i++) {
      const result = applyJitter(1000);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(1000);
    }
  });

  it("returns 0 when delay is 0", () => {
    expect(applyJitter(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Utility: isNetworkError
// ---------------------------------------------------------------------------

describe("isNetworkError", () => {
  it("returns true for ECONNRESET", () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    expect(isNetworkError(err)).toBe(true);
  });

  it("returns true for ETIMEDOUT", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(isNetworkError(err)).toBe(true);
  });

  it("returns true for ENOTFOUND", () => {
    const err = Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    expect(isNetworkError(err)).toBe(true);
  });

  it("returns true for EAI_AGAIN", () => {
    const err = Object.assign(new Error("dns"), { code: "EAI_AGAIN" });
    expect(isNetworkError(err)).toBe(true);
  });

  it("returns false for unknown codes", () => {
    const err = Object.assign(new Error("x"), { code: "ENOENT" });
    expect(isNetworkError(err)).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Policies: isRetryableHttpError
// ---------------------------------------------------------------------------

describe("isRetryableHttpError", () => {
  it("returns true for status 429", () => {
    expect(isRetryableHttpError({ status: 429 })).toBe(true);
  });

  it("returns true for 5xx statuses", () => {
    expect(isRetryableHttpError({ status: 500 })).toBe(true);
    expect(isRetryableHttpError({ status: 502 })).toBe(true);
    expect(isRetryableHttpError({ status: 503 })).toBe(true);
  });

  it("returns false for 4xx (except 429)", () => {
    expect(isRetryableHttpError({ status: 400 })).toBe(false);
    expect(isRetryableHttpError({ status: 401 })).toBe(false);
    expect(isRetryableHttpError({ status: 404 })).toBe(false);
    expect(isRetryableHttpError({ status: 422 })).toBe(false);
  });

  it("detects status on error.response.status", () => {
    expect(isRetryableHttpError({ response: { status: 503 } })).toBe(true);
    expect(isRetryableHttpError({ response: { status: 400 } })).toBe(false);
  });

  it("returns false when no status present", () => {
    expect(isRetryableHttpError(new Error("fail"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Policies: defaultRetryPolicy
// ---------------------------------------------------------------------------

describe("defaultRetryPolicy", () => {
  it("retries network errors", () => {
    const err = Object.assign(new Error("x"), { code: "ECONNRESET" });
    expect(defaultRetryPolicy(err)).toBe(true);
  });

  it("retries HTTP 500", () => {
    expect(defaultRetryPolicy({ status: 500, message: "err" })).toBe(true);
  });

  it("retries HTTP 429", () => {
    expect(defaultRetryPolicy({ status: 429, message: "err" })).toBe(true);
  });

  it("does not retry HTTP 400", () => {
    expect(defaultRetryPolicy({ status: 400, message: "err" })).toBe(false);
  });

  it("does not retry HTTP 404", () => {
    expect(defaultRetryPolicy({ status: 404, message: "err" })).toBe(false);
  });

  it("retries generic errors (no status/code)", () => {
    expect(defaultRetryPolicy(new TypeError("fetch failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("Error classes", () => {
  it("SmartRetryError extends Error", () => {
    const err = new SmartRetryError("test", { totalAttempts: 1, totalElapsedMs: 100 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SmartRetryError);
    expect(err.totalAttempts).toBe(1);
    expect(err.totalElapsedMs).toBe(100);
    expect(err.name).toBe("SmartRetryError");
  });

  it("TimeoutError extends SmartRetryError", () => {
    const err = new TimeoutError({ totalAttempts: 2, totalElapsedMs: 5000 });
    expect(err).toBeInstanceOf(SmartRetryError);
    expect(err.name).toBe("TimeoutError");
  });

  it("AbortError extends SmartRetryError", () => {
    const err = new AbortError({ totalAttempts: 1, totalElapsedMs: 200 });
    expect(err).toBeInstanceOf(SmartRetryError);
    expect(err.name).toBe("AbortError");
  });

  it("RetryExhaustedError extends SmartRetryError and preserves cause", () => {
    const cause = new Error("original");
    const err = new RetryExhaustedError(
      { totalAttempts: 4, totalElapsedMs: 3000 },
      { cause },
    );
    expect(err).toBeInstanceOf(SmartRetryError);
    expect(err.name).toBe("RetryExhaustedError");
    expect(err.cause).toBe(cause);
  });
});

// ---------------------------------------------------------------------------
// smartRetry: basic behaviour
// ---------------------------------------------------------------------------

describe("smartRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves on first attempt without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await smartRetry(fn, { maxRetries: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(0);
  });

  it("retries the correct number of times", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const promise = smartRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      jitter: false,
    });

    // Attach handler before advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it("succeeds on a later retry attempt", async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) throw new Error("not yet");
      return "success";
    });

    const promise = smartRetry(fn, {
      maxRetries: 5,
      baseDelayMs: 50,
      jitter: false,
    });

    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("passes attempt index to fn starting at 0", async () => {
    const attempts: number[] = [];
    const fn = vi.fn().mockImplementation(async (attempt: number) => {
      attempts.push(attempt);
      if (attempt < 2) throw new Error("fail");
      return "done";
    });

    const promise = smartRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      jitter: false,
    });

    await vi.runAllTimersAsync();

    await promise;
    expect(attempts).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// smartRetry: retryOn predicate
// ---------------------------------------------------------------------------

describe("smartRetry: retryOn", () => {
  it("stops retrying when retryOn returns false", async () => {
    const specificError = new Error("non-retryable");
    const fn = vi.fn().mockRejectedValue(specificError);

    const promise = smartRetry(fn, {
      maxRetries: 5,
      baseDelayMs: 10,
      jitter: false,
      retryOn: () => false,
    });

    // Should throw the original error, not RetryExhaustedError
    await expect(promise).rejects.toThrow(specificError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rethrows original error (not RetryExhaustedError) when retryOn returns false", async () => {
    const original = new Error("bad request");
    const fn = vi.fn().mockRejectedValue(original);

    try {
      await smartRetry(fn, {
        maxRetries: 3,
        retryOn: () => false,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBe(original);
      expect(err).not.toBeInstanceOf(RetryExhaustedError);
    }
  });
});

// ---------------------------------------------------------------------------
// smartRetry: onRetry callback
// ---------------------------------------------------------------------------

describe("smartRetry: onRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onRetry before each retry with correct arguments", async () => {
    const onRetry = vi.fn();
    const error = new Error("fail");
    const fn = vi.fn().mockRejectedValue(error);

    const promise = smartRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 100,
      jitter: false,
      onRetry,
    });

    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(onRetry).toHaveBeenCalledTimes(2);
    // First retry: attempt=1, delay=100
    expect(onRetry).toHaveBeenNthCalledWith(1, error, 1, 100);
    // Second retry: attempt=2, delay=200
    expect(onRetry).toHaveBeenNthCalledWith(2, error, 2, 200);
  });
});

// ---------------------------------------------------------------------------
// smartRetry: RetryExhaustedError
// ---------------------------------------------------------------------------

describe("smartRetry: RetryExhaustedError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws RetryExhaustedError with correct metadata", async () => {
    const cause = new Error("persistent failure");
    const fn = vi.fn().mockRejectedValue(cause);

    const promise = smartRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 10,
      jitter: false,
    });

    // Catch immediately to prevent unhandled rejection
    const settled = promise.catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    const err = await settled;
    expect(err).toBeInstanceOf(RetryExhaustedError);
    const retryErr = err as RetryExhaustedError;
    expect(retryErr.totalAttempts).toBe(3); // 1 + 2 retries
    expect(retryErr.cause).toBe(cause);
    expect(retryErr.totalElapsedMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// smartRetry: timeout
// ---------------------------------------------------------------------------

describe("smartRetry: timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws TimeoutError when total time exceeds timeoutMs", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      // Simulate slow operation
      await new Promise((resolve) => setTimeout(resolve, 200));
      throw new Error("fail");
    });

    const promise = smartRetry(fn, {
      maxRetries: 10,
      baseDelayMs: 100,
      timeoutMs: 500,
      jitter: false,
    });

    const assertion = expect(promise).rejects.toThrow(TimeoutError);
    await vi.runAllTimersAsync();
    await assertion;
  });
});

// ---------------------------------------------------------------------------
// smartRetry: AbortSignal
// ---------------------------------------------------------------------------

describe("smartRetry: AbortSignal", () => {
  it("throws AbortError immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");

    const fn = vi.fn().mockResolvedValue("ok");

    await expect(
      smartRetry(fn, { signal: controller.signal }),
    ).rejects.toThrow(AbortError);

    expect(fn).not.toHaveBeenCalled();
  });

  it("throws AbortError when signal is aborted during retry delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const promise = smartRetry(fn, {
      maxRetries: 5,
      baseDelayMs: 1000,
      jitter: false,
      signal: controller.signal,
    });

    const assertion = expect(promise).rejects.toThrow(AbortError);

    // Let the first attempt fail and enter retry delay
    await vi.advanceTimersByTimeAsync(0);

    // Abort during the delay
    controller.abort("user cancelled");
    await vi.advanceTimersByTimeAsync(0);

    await assertion;
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// smartRetry: configuration validation
// ---------------------------------------------------------------------------

describe("smartRetry: validation", () => {
  it("throws on negative maxRetries", async () => {
    await expect(
      smartRetry(async () => "ok", { maxRetries: -1 }),
    ).rejects.toThrow("maxRetries must be >= 0");
  });

  it("throws on zero baseDelayMs", async () => {
    await expect(
      smartRetry(async () => "ok", { baseDelayMs: 0 }),
    ).rejects.toThrow("baseDelayMs must be > 0");
  });

  it("throws on negative baseDelayMs", async () => {
    await expect(
      smartRetry(async () => "ok", { baseDelayMs: -100 }),
    ).rejects.toThrow("baseDelayMs must be > 0");
  });

  it("throws when maxDelayMs < baseDelayMs", async () => {
    await expect(
      smartRetry(async () => "ok", { baseDelayMs: 500, maxDelayMs: 100 }),
    ).rejects.toThrow("maxDelayMs");
  });

  it("throws on zero timeoutMs", async () => {
    await expect(
      smartRetry(async () => "ok", { timeoutMs: 0 }),
    ).rejects.toThrow("timeoutMs must be > 0");
  });

  it("throws on negative timeoutMs", async () => {
    await expect(
      smartRetry(async () => "ok", { timeoutMs: -1 }),
    ).rejects.toThrow("timeoutMs must be > 0");
  });
});

// ---------------------------------------------------------------------------
// smartRetry: backoff without jitter
// ---------------------------------------------------------------------------

describe("smartRetry: exponential backoff delays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses exponential backoff delays when jitter is false", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const promise = smartRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 10000,
      jitter: false,
      onRetry: (_err, _attempt, delay) => {
        delays.push(delay);
      },
    });

    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(delays).toEqual([100, 200, 400]);
  });
});

// ---------------------------------------------------------------------------
// smartRetry: jitter
// ---------------------------------------------------------------------------

describe("smartRetry: jitter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies jitter producing delays within expected range", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    const promise = smartRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      jitter: true,
      onRetry: (_err, _attempt, delay) => {
        delays.push(delay);
      },
    });

    const assertion = expect(promise).rejects.toThrow(RetryExhaustedError);
    await vi.runAllTimersAsync();
    await assertion;

    expect(delays).toHaveLength(3);
    // Retry 0: base=1000, max jitter=1000 -> [0, 1000)
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]!).toBeLessThan(1000);
    // Retry 1: base=2000, max jitter=2000 -> [0, 2000)
    expect(delays[1]).toBeGreaterThanOrEqual(0);
    expect(delays[1]!).toBeLessThan(2000);
    // Retry 2: base=4000, max jitter=4000 -> [0, 4000)
    expect(delays[2]).toBeGreaterThanOrEqual(0);
    expect(delays[2]!).toBeLessThan(4000);
  });
});

// ---------------------------------------------------------------------------
// smartRetry: zero retries
// ---------------------------------------------------------------------------

describe("smartRetry: edge cases", () => {
  it("works with maxRetries = 0 (single attempt)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("once"));

    await expect(
      smartRetry(fn, { maxRetries: 0 }),
    ).rejects.toThrow(RetryExhaustedError);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses default options when none provided", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await smartRetry(fn);
    expect(result).toBe(42);
  });
});

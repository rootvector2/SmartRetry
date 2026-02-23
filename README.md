# SmartRetry

[![npm version](https://img.shields.io/npm/v/@rootvector/smart-retry.svg)](https://www.npmjs.com/package/@rootvector/smart-retry)
[![npm downloads](https://img.shields.io/npm/dm/@rootvector/smart-retry.svg)](https://www.npmjs.com/package/@rootvector/smart-retry)
[![CI](https://github.com/rootvector2/SmartRetry/actions/workflows/ci.yml/badge.svg)](https://github.com/rootvector2/SmartRetry/actions)
[![License](https://img.shields.io/npm/l/@rootvector/smart-retry.svg)](LICENSE)

Async functions fail. Networks drop, servers return 500s, rate limits kick in. SmartRetry wraps any async function with configurable retry logic — exponential backoff, jitter, global timeouts, and cancellation via `AbortSignal` — so you don't have to write that boilerplate again.

## Features

- **Exponential backoff** with configurable base and max delay
- **Full jitter** to prevent thundering herd problems
- **Global timeout** across all attempts (not per-attempt)
- **AbortSignal** support for cancellation
- **Intelligent default policy** — retries network errors, 429s, and 5xx; stops on 4xx
- **Custom retry predicates** — full control over what gets retried
- **Zero runtime dependencies**
- **ESM + CJS** dual build with proper type declarations
- **Tree-shakeable** and side-effect free
- **Node.js >= 18** and modern browsers

## Why SmartRetry?

Most retry implementations:
- Retry too aggressively
- Do not support global timeout
- Lack AbortSignal support
- Wrap non-retryable errors incorrectly

SmartRetry focuses on correctness, predictable behavior, and production-safe defaults.

## Installation

```bash
npm install @rootvector/smart-retry
```

## Basic Usage

```ts
import { smartRetry } from "@rootvector/smart-retry";

const data = await smartRetry(
  async (attempt) => {
    const res = await fetch("https://api.example.com/data");
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  {
    maxRetries: 5,
    baseDelayMs: 200,
    timeoutMs: 10000,
  }
);
```

The `attempt` parameter starts at `0` for the initial call. `maxRetries` controls **additional** attempts after the first, so total attempts = `1 + maxRetries`.

## Advanced Usage

### Custom Retry Predicate

```ts
import { smartRetry } from "@rootvector/smart-retry";

await smartRetry(callExternalService, {
  maxRetries: 4,
  retryOn: (error, attempt) => {
    // Only retry on specific conditions
    if (error instanceof TypeError) return true;
    if (error instanceof Error && error.message.includes("rate limit")) return true;
    return false;
  },
  onRetry: (error, attempt, delay) => {
    console.log(`Attempt ${attempt} in ${Math.round(delay)}ms...`);
  },
});
```

### Cancellation with AbortSignal

```ts
import { smartRetry, AbortError } from "@rootvector/smart-retry";

const controller = new AbortController();
setTimeout(() => controller.abort(), 3000);

try {
  await smartRetry(fn, {
    maxRetries: 10,
    signal: controller.signal,
  });
} catch (err) {
  if (err instanceof AbortError) {
    // Operation was cancelled
  }
}
```

### Global Timeout

```ts
import { smartRetry, TimeoutError } from "@rootvector/smart-retry";

try {
  await smartRetry(fn, {
    maxRetries: 10,
    timeoutMs: 15000, // 15 seconds total, not per-attempt
  });
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error(`Timed out after ${err.totalElapsedMs}ms`);
  }
}
```

## API

### `smartRetry<T>(fn, options?): Promise<T>`

Executes `fn` and retries on failure according to the provided options.

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(attempt: number) => Promise<T>` | Async function to execute. `attempt` is 0-indexed. |
| `options` | `RetryOptions` | Optional configuration. |

### `RetryOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | `number` | `3` | Retry attempts after the initial call. Total = `1 + maxRetries`. |
| `baseDelayMs` | `number` | `300` | Base delay (ms) for exponential backoff. |
| `maxDelayMs` | `number` | `5000` | Upper bound for computed delay. |
| `jitter` | `boolean` | `true` | Apply full jitter: `random(0, computedDelay)`. |
| `retryOn` | `(error, attempt) => boolean` | *default policy* | Return `true` to retry, `false` to stop. |
| `onRetry` | `(error, attempt, delay) => void` | — | Called before each retry. |
| `timeoutMs` | `number` | — | Global timeout across all attempts. |
| `signal` | `AbortSignal` | — | Cancellation signal. |

### `isRetryableHttpError(error: unknown): boolean`

Standalone utility that returns `true` if the error carries an HTTP status of 429 or 500–599. Inspects `error.status` and `error.response?.status`.

## Backoff Algorithm

```
delay = min(maxDelayMs, baseDelayMs * 2^retryIndex)
```

Where `retryIndex` is 0 for the first retry. With jitter enabled, the final delay is `random(0, delay)`.

## Default Retry Policy

When no `retryOn` predicate is provided, SmartRetry uses a built-in policy:

| Condition | Retried? |
|-----------|----------|
| Network errors (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`) | Yes |
| HTTP 429 (Too Many Requests) | Yes |
| HTTP 500–599 (Server errors) | Yes |
| HTTP 400–499 (Client errors, except 429) | No |
| Errors without a recognized status or code | Yes |

## Error Handling

All errors thrown by SmartRetry extend `SmartRetryError` and include:

- `totalAttempts` — number of attempts made
- `totalElapsedMs` — total wall-clock time in milliseconds
- `cause` — the original error (via standard `ErrorOptions`)

| Error Class | When Thrown |
|-------------|------------|
| `RetryExhaustedError` | All retry attempts failed |
| `TimeoutError` | Global `timeoutMs` exceeded |
| `AbortError` | `AbortSignal` was aborted |

When `retryOn` returns `false`, the original error is rethrown directly — it is **not** wrapped in `RetryExhaustedError`.

```ts
import { smartRetry, RetryExhaustedError, TimeoutError } from "@rootvector/smart-retry";

try {
  await smartRetry(fn, { maxRetries: 3, timeoutMs: 5000 });
} catch (err) {
  if (err instanceof TimeoutError) {
    console.error(`Timed out after ${err.totalElapsedMs}ms`);
  } else if (err instanceof RetryExhaustedError) {
    console.error(`Failed after ${err.totalAttempts} attempts:`, err.cause);
  }
}
```

## Real-World Example: API Client

Wrapping an API call with structured retry logic:

```ts
import { smartRetry, TimeoutError, RetryExhaustedError } from "@rootvector/smart-retry";

async function fetchUser(userId: string) {
  return smartRetry(
    async () => {
      const res = await fetch(`https://api.example.com/users/${userId}`);
      if (!res.ok) {
        const err: any = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    {
      maxRetries: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      timeoutMs: 15000,
      onRetry: (error, attempt, delay) => {
        console.warn(`Retry ${attempt} for user ${userId} in ${Math.round(delay)}ms`);
      },
    }
  );
}
```

## Configuration Validation

Invalid options throw synchronously with descriptive messages:

- `maxRetries < 0`
- `baseDelayMs <= 0`
- `maxDelayMs < baseDelayMs`
- `timeoutMs <= 0`

## Versioning

SmartRetry follows [Semantic Versioning (SemVer)](https://semver.org/).

- **Patch** — Bug fixes
- **Minor** — Backward-compatible improvements
- **Major** — Breaking API changes

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.

```bash
git clone https://github.com/rootvector2/SmartRetry.git
cd SmartRetry
npm install
npm test
npm run build
```

## License

MIT

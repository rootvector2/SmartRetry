# Implementing a Correct Retry Mechanism in TypeScript (With Backoff, Jitter & AbortSignal)

## Outline

### 1. Why Naive Retry Is Dangerous

- The instinct to "just retry" masks real failure modes
- Unbounded retries amplify load on failing services
- Silent retry loops hide bugs and delay incident detection

### 2. The Thundering Herd Problem

- What happens when thousands of clients retry simultaneously
- Fixed-delay retries create synchronized spikes
- Real-world examples: AWS outages, API rate limit cascades

### 3. Why Jitter Matters

- Exponential backoff alone still creates clusters
- Full jitter vs. equal jitter vs. decorrelated jitter
- Mathematical intuition: spreading retry attempts across time
- Reference: AWS Architecture Blog on exponential backoff

### 4. Timeout: Global vs. Per-Attempt

- Per-attempt timeout: each call gets N seconds (incomplete picture)
- Global timeout: total wall-clock budget across all attempts
- Why global timeout is the correct default for production systems
- Edge case: what if the last retry starts just before timeout?

### 5. AbortSignal Correctness

- Why cancellation is not optional in production async code
- Common mistakes: not cleaning up listeners, ignoring abort during sleep
- Correct pattern: wiring AbortSignal through retry loop and delay
- Interaction between AbortSignal and global timeout

### 6. Common Bugs in Retry Loops

- Retrying non-retryable errors (400, 401, 403, 404)
- Wrapping all errors in a generic "retry failed" error
- Off-by-one: `maxRetries` vs. total attempts
- Not clamping delay to remaining timeout budget
- Leaking timers on abort

### 7. Introducing SmartRetry

- Design goals: correctness, predictability, zero dependencies
- Default retry policy: network errors, 429, 5xx — stop on 4xx
- Full jitter by default
- Global timeout with proper delay clamping
- AbortSignal support with clean teardown
- ESM + CJS dual build, fully typed

### 8. Example Usage

- Basic: wrapping a fetch call
- Advanced: custom retry predicate with structured logging
- Cancellation: AbortController with timeout fallback

### 9. Benchmarks (Future)

- Retry storm simulation: SmartRetry vs. naive loops
- Jitter distribution visualization
- Memory and timer cleanup validation

---

**Target platforms:** Dev.to, Hashnode, Medium, personal blog

**Estimated length:** 2,500–3,500 words

**Goal:** Establish authority on retry correctness; drive organic traffic to the npm package.

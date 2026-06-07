/**
 * Forward policy for the channel-gateway downstream link (issue #483, Phase 2).
 *
 * Pure control flow, kept out of the MCP adapter so it is unit-testable:
 *
 *  - A call that arrives while the link is down is BUFFERED (not failed): it was
 *    never sent, so replaying it after reconnect cannot double-execute. The
 *    buffer is bounded — once `maxQueued` calls are already waiting, further
 *    calls are rejected (backpressure) instead of growing without limit.
 *  - A call that was SENT and then failed is retried once after reconnect only
 *    if it is a read (idempotent). Writes are never blind-retried: the request
 *    may have executed before the link dropped, and a retry would double it.
 */

/** Injected hooks; the gateway supplies real transport, tests supply fakes. */
export interface ForwardPolicy {
  /** True if `name` is an idempotent read (safe to retry). */
  isRead: (name: string) => boolean;
  /** Current downstream link health. */
  isConnected: () => boolean;
  /**
   * Wait for the link to come back, bounded. Resolves once connected; rejects on
   * timeout or when the bounded buffer is full. The gateway counts in-flight
   * waiters here to enforce `maxQueued`.
   */
  waitForConnection: () => Promise<void>;
  /** Send one call over the (assumed live) downstream link. */
  call: (name: string, args: unknown) => Promise<unknown>;
}

/**
 * Forward one call under the read-safe / write-no-retry policy with bounded
 * buffering across a reconnect. Throws if the buffer is full (via
 * `waitForConnection`) or a non-retryable call fails.
 */
export async function forwardWithPolicy(
  policy: ForwardPolicy,
  name: string,
  args: unknown,
): Promise<unknown> {
  // Not yet sent: safe to buffer until the link returns, for reads and writes.
  if (!policy.isConnected()) {
    await policy.waitForConnection();
  }
  try {
    return await policy.call(name, args);
  } catch (err) {
    // Sent but failed: only idempotent reads may be replayed.
    if (policy.isRead(name)) {
      await policy.waitForConnection();
      return await policy.call(name, args);
    }
    throw err;
  }
}

/** A tool call is an idempotent read by name prefix. */
export function isReadCall(name: string): boolean {
  return name.startsWith('browse_') || name.startsWith('get_') || name.startsWith('list_');
}

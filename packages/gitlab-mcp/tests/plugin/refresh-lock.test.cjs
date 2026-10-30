const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { setImmediate } = require('node:timers/promises');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runtimeRequire } = require('./runtime.cjs');
const { RefreshGuard } = runtimeRequire('./refresh-guard.js');

test(
  'closing a refresh guard rejects waiting and future operations',
  { timeout: 5000 },
  async () => {
    // Shutdown must not run a queued token refresh after its authorization owner closes.
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-refresh-close-'));
    const path = join(dir, 'lock.sqlite');
    const holder = new RefreshGuard(path);
    const waiter = new RefreshGuard(path);
    let release;
    let locked;
    const started = new Promise((resolve) => {
      locked = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const holding = holder.run(async () => {
      locked();
      await pending;
    });
    let executed = false;
    try {
      await started;
      const waiting = waiter.run(async () => {
        executed = true;
      });
      const rejected = assert.rejects(waiting, /OAuth connection closed/);
      await setImmediate();
      await waiter.close();
      await rejected;
      await assert.rejects(
        waiter.run(async () => {
          executed = true;
        }),
        /OAuth connection closed/,
      );
      assert.equal(executed, false);
    } finally {
      release();
      await holding;
      await waiter.close();
      await holder.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('a crashed process releases the shared OAuth refresh lock', { timeout: 15000 }, async () => {
  // The OS releases ownership after a crash; recovery must not depend on an expiring lease.
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-refresh-'));
  const path = join(dir, 'lock.sqlite');
  const child = fork(
    join(__dirname, 'fixtures/hold-refresh-lock.cjs'),
    [runtimeRequire.resolve('./refresh-guard.js'), path],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  );
  const lock = new RefreshGuard(path);
  try {
    const [message] = await once(child, 'message');
    assert.equal(message, 'locked');
    let entered = false;
    const acquiring = lock.run(async () => {
      entered = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(entered, false);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    await acquiring;
    assert.equal(entered, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await lock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

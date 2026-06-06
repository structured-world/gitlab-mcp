/**
 * Unit tests for the gateway forward policy (issue #483, Phase 2): bounded
 * buffering across a reconnect, idempotent-read retry, write-no-retry.
 */
import {
  forwardWithPolicy,
  isReadCall,
  type ForwardPolicy,
} from '../../../src/channel-gateway/forwarding';

function policy(over: Partial<ForwardPolicy>): ForwardPolicy {
  return {
    isRead: isReadCall,
    isConnected: () => true,
    waitForConnection: () => Promise.resolve(),
    call: () => Promise.resolve('ok'),
    ...over,
  };
}

describe('isReadCall', () => {
  it('classifies read prefixes', () => {
    expect(isReadCall('browse_pipelines')).toBe(true);
    expect(isReadCall('get_users')).toBe(true);
    expect(isReadCall('list_labels')).toBe(true);
  });
  it('classifies writes as non-read', () => {
    expect(isReadCall('manage_pipeline')).toBe(false);
    expect(isReadCall('manage_merge_request')).toBe(false);
  });
});

describe('forwardWithPolicy', () => {
  it('calls directly when connected', async () => {
    const call = jest.fn(() => Promise.resolve('result'));
    const waitForConnection = jest.fn(() => Promise.resolve());
    const out = await forwardWithPolicy(
      policy({ call, waitForConnection }),
      'browse_pipelines',
      {},
    );
    expect(out).toBe('result');
    expect(waitForConnection).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('buffers an un-sent call until reconnect, then sends once', async () => {
    let connected = false;
    const call = jest.fn(() => Promise.resolve('result'));
    const waitForConnection = jest.fn(() => {
      connected = true;
      return Promise.resolve();
    });
    const out = await forwardWithPolicy(
      policy({ call, waitForConnection, isConnected: () => connected }),
      'manage_pipeline', // even a write is safe to buffer: it was never sent
      {},
    );
    expect(out).toBe('result');
    expect(waitForConnection).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('retries a read once after a sent-then-failed call', async () => {
    let n = 0;
    const call = jest.fn(() => {
      n++;
      return n === 1 ? Promise.reject(new Error('link dropped')) : Promise.resolve('result');
    });
    const out = await forwardWithPolicy(policy({ call }), 'browse_pipelines', {});
    expect(out).toBe('result');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('never retries a write that was sent and failed', async () => {
    const call = jest.fn(() => Promise.reject(new Error('link dropped')));
    await expect(forwardWithPolicy(policy({ call }), 'manage_pipeline', {})).rejects.toThrow(
      'link dropped',
    );
    expect(call).toHaveBeenCalledTimes(1); // no second attempt
  });

  it('propagates a full-buffer rejection from waitForConnection', async () => {
    const waitForConnection = jest.fn(() => Promise.reject(new Error('buffer full')));
    await expect(
      forwardWithPolicy(
        policy({ isConnected: () => false, waitForConnection }),
        'browse_pipelines',
        {},
      ),
    ).rejects.toThrow('buffer full');
  });

  it('gives up after a single read retry if it fails again', async () => {
    const call = jest.fn(() => Promise.reject(new Error('still down')));
    await expect(forwardWithPolicy(policy({ call }), 'browse_pipelines', {})).rejects.toThrow(
      'still down',
    );
    expect(call).toHaveBeenCalledTimes(2); // initial + one retry, then give up
  });
});

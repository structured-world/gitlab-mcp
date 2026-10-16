import { mapBounded } from '../../../src/utils/bounded-map';

describe('mapBounded', () => {
  // Results must line up with their items even when later items finish first.
  it('keeps the item order of the results', async () => {
    const delays = [30, 5, 15, 0];
    const results = await mapBounded(delays, 2, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay * 2;
    });
    expect(results).toEqual([60, 10, 30, 0]);
  });

  // The bound is the whole point: never more than `limit` tasks in flight.
  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await mapBounded([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
    });
    expect(peak).toBe(3);
  });

  // A free worker starts the next item without waiting for the slow one beside it.
  it('starts the next item while a slow one is still running', async () => {
    const started: number[] = [];
    let releaseSlow: () => void = () => {};
    const done = mapBounded([0, 1, 2, 3], 2, async (item) => {
      started.push(item);
      if (item === 0) await new Promise<void>((resolve) => (releaseSlow = resolve));
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(started).toEqual([0, 1, 2, 3]);
    releaseSlow();
    await done;
  });

  // A failure rejects the call and stops new items from starting.
  it('rejects with the first failure and starts nothing after it', async () => {
    const started: number[] = [];
    await expect(
      mapBounded([1, 2, 3, 4, 5], 1, async (item) => {
        started.push(item);
        if (item === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });

  it('answers an empty list without running anything', async () => {
    const task = jest.fn();
    await expect(mapBounded([], 5, task)).resolves.toEqual([]);
    expect(task).not.toHaveBeenCalled();
  });
});

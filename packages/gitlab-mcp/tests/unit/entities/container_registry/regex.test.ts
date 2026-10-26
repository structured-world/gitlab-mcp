import {
  withTagMatcher,
  closeTagMatchers,
} from '../../../../src/entities/container_registry/regex';

afterAll(closeTagMatchers);

describe('registry regex isolation', () => {
  // Preserve supported cleanup patterns and unanchored matching without backtracking.
  it.each([
    ['^v\\d+$', undefined, ['v1', 'latest', 'v20'], [0, 2]],
    ['v[12]', undefined, ['av1', 'v3'], [0]],
    ['^(aa|bb)$', undefined, ['aa', 'ab'], [0]],
    ['.*', 'keep', ['v1', 'keep-v2'], [0]],
    ['.*', '', ['v1', 'v2'], [0, 1]],
  ] as const)('preserves selection for %s', async (remove, keep, names, expected) => {
    await expect(withTagMatcher(remove, keep, (match) => match([...names]))).resolves.toEqual(
      expected,
    );
  });

  // Both patterns are validated before the callback can make a GitLab request or delete anything.
  it.each([
    ['[', undefined],
    ['.*', '['],
    ['v(?=1)', undefined],
    ['^(a)\\1$', undefined],
    ['a{1000}a{1000}', undefined],
    ['a'.repeat(501), undefined],
    ['.*', 'a'.repeat(501)],
  ])('rejects invalid patterns before fetching tags', async (remove, keep) => {
    const operation = jest.fn();
    await expect(withTagMatcher(remove, keep, operation)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
  });

  // A pathological keep expression completes linearly and must not prevent subsequent calls.
  it('matches a pathological keep expression without backtracking', async () => {
    await expect(
      withTagMatcher('.*', '(a+)+$', (match) => match(['a'.repeat(40) + '!'])),
    ).resolves.toEqual([0]);
    await expect(withTagMatcher('v', undefined, (match) => match(['v1']))).resolves.toEqual([0]);
  });

  // A failed GitLab request must not leave a worker or occupied capacity behind.
  it('releases the worker when fetching tags fails', async () => {
    const error = new Error('GitLab unavailable');
    await expect(
      withTagMatcher('.*', undefined, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    await expect(withTagMatcher('.*', undefined, (match) => match([]))).resolves.toEqual([]);
  });

  // Parallel hostile requests cannot create an unbounded number of worker threads or a queue.
  it('bounds concurrent workers and releases admission after completion', async () => {
    let release!: () => void;
    let entered = 0;
    let bothEntered!: () => void;
    const ready = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = () =>
      withTagMatcher('.*', undefined, async () => {
        if (++entered === 2) bothEntered();
        await blocked;
      });
    const calls = [hold(), hold()];
    try {
      await ready;
      await expect(withTagMatcher('.*', undefined, async () => undefined)).rejects.toThrow(
        'capacity',
      );
    } finally {
      release();
      await Promise.all(calls);
    }
    await expect(withTagMatcher('.*', undefined, (match) => match(['v1']))).resolves.toEqual([0]);
  });
});

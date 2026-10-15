/**
 * Run `task` on every item with at most `limit` running at once; results keep the item
 * order. A worker takes the next item as soon as its previous one finishes, so one slow
 * request does not hold back a whole batch. After the first failure no new item starts,
 * and the promise rejects with that failure.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

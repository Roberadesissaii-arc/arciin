/** Run async work over items with a fixed concurrency limit. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  const concurrency = Math.max(1, Math.min(limit, items.length))
  let index = 0

  async function runNext(): Promise<void> {
    while (index < items.length) {
      const current = items[index++]!
      await worker(current)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runNext()))
}

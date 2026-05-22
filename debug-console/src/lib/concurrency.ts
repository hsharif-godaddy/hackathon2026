/**
 * Run an async mapper over an array with a fixed concurrency cap.
 * Order of results matches order of input.
 *
 * Note: rejections from `fn` propagate. Catch inside `fn` if you need
 * partial-failure semantics.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    const workers = Array.from({ length: workerCount }, async () => {
        for (;;) {
            const i = cursor++;
            if (i >= items.length) return;
            results[i] = await fn(items[i]!, i);
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * Per-key async mutex. Tasks submitted under the same key run strictly serially
 * (in submission order); tasks under different keys run concurrently. Used to
 * serialize actions on the same pageId while keeping different pages parallel.
 *
 * Implemented as a per-key promise chain: each new task awaits the current tail
 * for its key, then becomes the new tail. The chain stores resolved promises
 * (never rejected) so one task's failure cannot poison the queue.
 */
export class PageLock {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();

    const result = prev.then(() => fn());

    // The next task chains off this one completing, regardless of outcome.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);

    // Garbage-collect the map entry once this is the last queued task for the key.
    void tail.then(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });

    return result;
  }
}

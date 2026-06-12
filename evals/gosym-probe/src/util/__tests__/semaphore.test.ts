import { describe, it, expect } from 'vitest';
import { createSemaphore } from '../semaphore.js';

describe('createSemaphore', () => {
  it('acquires immediately (unbounded) with a no-op release when permits <= 0', async () => {
    const sem = createSemaphore(0);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(typeof r1).toBe('function');
    expect(typeof r2).toBe('function');
    // No-op releases must not throw.
    r1();
    r2();
  });

  it('treats a non-finite permit count as unbounded', async () => {
    const sem = createSemaphore(Number.NaN);
    const release = await sem.acquire();
    expect(typeof release).toBe('function');
    release();
  });

  it('serializes acquisition when permits = 1', async () => {
    const sem = createSemaphore(1);
    const order: string[] = [];

    const r1 = await sem.acquire();
    order.push('a-acquired');

    let secondAcquired = false;
    const p2 = sem.acquire().then((rel) => {
      secondAcquired = true;
      order.push('b-acquired');
      return rel;
    });

    // The second acquire must block until the first releases.
    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    r1();
    const r2 = await p2;
    expect(secondAcquired).toBe(true);
    expect(order).toEqual(['a-acquired', 'b-acquired']);
    r2();
  });

  it('allows up to `permits` concurrent holders', async () => {
    const sem = createSemaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();

    let thirdAcquired = false;
    const p3 = sem.acquire().then((rel) => {
      thirdAcquired = true;
      return rel;
    });

    await Promise.resolve();
    expect(thirdAcquired).toBe(false);

    r1();
    const r3 = await p3;
    expect(thirdAcquired).toBe(true);
    r2();
    r3();
  });

  it('hands permits to queued waiters in FIFO order', async () => {
    const sem = createSemaphore(1);
    const order: number[] = [];

    const hold = await sem.acquire();
    const waiters = [1, 2, 3].map((n) =>
      sem.acquire().then((rel) => {
        order.push(n);
        return rel;
      }),
    );

    hold();
    const rel1 = await waiters[0];
    rel1();
    const rel2 = await waiters[1];
    rel2();
    const rel3 = await waiters[2];
    rel3();

    expect(order).toEqual([1, 2, 3]);
  });

  it('is idempotent: a double release frees only one permit', async () => {
    const sem = createSemaphore(1);
    const r1 = await sem.acquire();
    r1();
    r1(); // second call must be a no-op

    const r2 = await sem.acquire();
    let thirdAcquired = false;
    const p3 = sem.acquire().then((rel) => {
      thirdAcquired = true;
      return rel;
    });

    await Promise.resolve();
    // If the double release had freed two permits, the third acquire
    // would have proceeded. It must still be blocked.
    expect(thirdAcquired).toBe(false);

    r2();
    await p3;
    expect(thirdAcquired).toBe(true);
  });

  it('releases the permit even when the protected body throws (caller responsibility)', async () => {
    const sem = createSemaphore(1);
    const release = await sem.acquire();
    try {
      throw new Error('boom');
    } catch {
      // emulate the finally-release pattern callers use
    } finally {
      release();
    }
    // Permit must be reusable.
    const again = await sem.acquire();
    expect(typeof again).toBe('function');
    again();
  });
});

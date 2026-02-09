import { RequestQueue } from '../../utils/requestQueue';

describe('RequestQueue', () => {
  it('runs tasks serially when maxConcurrency is 1', async () => {
    const queue = new RequestQueue({ maxConcurrency: 1 });
    const results: number[] = [];

    const makeTask = (value: number, delayMs: number): (() => Promise<number>) => {
      return () =>
        new Promise<number>(resolve => {
          setTimeout(() => {
            results.push(value);
            resolve(value);
          }, delayMs);
        });
    };

    const p1 = queue.add(makeTask(1, 20));
    const p2 = queue.add(makeTask(2, 5));
    const p3 = queue.add(makeTask(3, 1));

    await Promise.all([p1, p2, p3]);

    // With maxConcurrency = 1, tasks should complete in the order they were queued.
    expect(results).toEqual([1, 2, 3]);
  });

  it('honours maxConcurrency > 1', async () => {
    const queue = new RequestQueue({ maxConcurrency: 2 });
    let concurrent = 0;
    let peakConcurrent = 0;

    const makeTask = (delayMs: number): (() => Promise<void>) => {
      return () =>
        new Promise<void>(resolve => {
          concurrent += 1;
          peakConcurrent = Math.max(peakConcurrent, concurrent);
          setTimeout(() => {
            concurrent -= 1;
            resolve();
          }, delayMs);
        });
    };

    await Promise.all([
      queue.add(makeTask(10)),
      queue.add(makeTask(10)),
      queue.add(makeTask(10)),
      queue.add(makeTask(10))
    ]);

    expect(peakConcurrent).toBeLessThanOrEqual(2);
  });
});
import { logger } from './logger';

export interface RequestQueueOptions {
  /**
   * Maximum number of tasks that can run at the same time.
   * Defaults to 1 (strictly serial execution).
   */
  maxConcurrency?: number;
}

interface QueueItem<T> {
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  onStart?: () => void | Promise<void>;
  onComplete?: () => void | Promise<void>;
}

/**
 * Simple in-memory request queue with configurable concurrency.
 *
 * This is intended to protect heavy or rate-limited operations
 * (e.g. Puppeteer / swgoh.gg scraping) from being executed many
 * times in parallel when multiple Discord commands fire at once.
 */
export class RequestQueue {
  private readonly maxConcurrency: number;
  private activeCount = 0;
  private readonly queue: Array<QueueItem<unknown>> = [];

  constructor(options?: RequestQueueOptions) {
    this.maxConcurrency = Math.max(1, options?.maxConcurrency ?? 1);
  }

  /**
   * Current number of tasks either running or waiting in the queue.
   */
  getSize(): number {
    return this.activeCount + this.queue.length;
  }

  /**
   * Enqueue a task for execution. The task will be run when
   * concurrency permits and the returned promise will resolve
   * or reject with the task's result.
   */
  add<T>(task: () => Promise<T>, hooks?: { onStart?: () => void | Promise<void>; onComplete?: () => void | Promise<void> }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        task,
        resolve,
        reject,
        onStart: hooks?.onStart,
        onComplete: hooks?.onComplete
      };
      this.queue.push(item as QueueItem<unknown>);
      this.processQueue();
    });
  }

  /**
   * Enqueue a task and also return the position it was given in the
   * queue (1 = either running now or next to run). This is useful for
   * user-facing messaging such as Discord command status.
   */
  addWithPosition<T>(
    task: () => Promise<T>,
    hooks?: { onStart?: () => void | Promise<void>; onComplete?: () => void | Promise<void> }
  ): { position: number; promise: Promise<T> } {
    const position = this.getSize() + 1;
    const promise = this.add(task, hooks);
    return { position, promise };
  }

  private processQueue(): void {
    // Nothing waiting or already at concurrency limit
    if (this.activeCount >= this.maxConcurrency) {
      return;
    }

    const item = this.queue.shift();
    if (!item) {
      return;
    }

    this.activeCount += 1;

    // Safely call onStart callback - errors should not prevent task execution
    if (item.onStart) {
      try {
        const result = item.onStart();
        // Handle async callbacks that return promises
        if (result && typeof result === 'object' && 'catch' in result && typeof (result as Promise<void>).catch === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          (result as Promise<void>).catch((error: unknown) => {
            logger.warn('Error in onStart callback (async):', error);
          });
        }
      } catch (error) {
        // Log but don't throw - callback errors should not stop the queue
        logger.warn('Error in onStart callback:', error);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      try {
        const result = await item.task();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      } finally {
        this.activeCount -= 1;
        // Safely call onComplete callback - errors should not prevent queue processing
        if (item.onComplete) {
          try {
            const result = item.onComplete();
            // Handle async callbacks that return promises
            if (result && typeof result === 'object' && 'catch' in result && typeof (result as Promise<void>).catch === 'function') {
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              (result as Promise<void>).catch((error: unknown) => {
                logger.warn('Error in onComplete callback (async):', error);
              });
            }
          } catch (error) {
            // Log but don't throw - callback errors should not stop the queue
            logger.warn('Error in onComplete callback:', error);
          }
        }
        this.processQueue();
      }
    })();
  }
}



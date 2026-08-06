import { describe, expect, it } from 'vitest';
import { loadSequentially, type LoadProgress, type LoadTask } from './AssetLoader';

function task(name: string, load: () => Promise<void>): LoadTask {
  return { name, load };
}

describe('loadSequentially', () => {
  it('runs every task to completion in order, one at a time', async () => {
    const order: string[] = [];
    const tasks = [
      task('a', async () => {
        order.push('a-start');
        await Promise.resolve();
        order.push('a-end');
      }),
      task('b', async () => {
        order.push('b-start');
        await Promise.resolve();
        order.push('b-end');
      }),
    ];

    await loadSequentially(tasks);

    // If these ran concurrently, both *-start entries would appear before either *-end.
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('reports progress before the first task and after every task settles', async () => {
    const progress: LoadProgress[] = [];
    const tasks = [task('a', async () => {}), task('b', async () => {})];

    await loadSequentially(tasks, (p) => progress.push({ ...p }));

    expect(progress).toEqual([
      { loaded: 0, total: 2, current: 'a' },
      { loaded: 0, total: 2, current: 'a' },
      { loaded: 1, total: 2, current: 'b' },
      { loaded: 1, total: 2, current: 'b' },
      { loaded: 2, total: 2, current: undefined },
    ]);
  });

  it('reports an empty-but-complete progress state for an empty task list', async () => {
    const progress: LoadProgress[] = [];

    await loadSequentially([], (p) => progress.push({ ...p }));

    expect(progress).toEqual([{ loaded: 0, total: 0, current: undefined }]);
  });

  it('continues loading remaining tasks after one fails, rather than aborting the rest', async () => {
    const completed: string[] = [];
    const tasks = [
      task('a', async () => {
        completed.push('a');
      }),
      task('b', async () => {
        throw new Error('b failed');
      }),
      task('c', async () => {
        completed.push('c');
      }),
    ];

    await expect(loadSequentially(tasks)).rejects.toThrow(AggregateError);
    expect(completed).toEqual(['a', 'c']);
  });

  it('rejects with an AggregateError listing every failure once all tasks have settled', async () => {
    const tasks = [
      task('a', async () => {
        throw new Error('first failure');
      }),
      task('b', async () => {
        throw new Error('second failure');
      }),
    ];

    const result = await loadSequentially(tasks).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AggregateError);
    const aggregate = result as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors.map((e: Error) => e.message)).toEqual(['first failure', 'second failure']);
  });

  it('wraps a non-Error thrown value in an Error rather than passing it through raw', async () => {
    const tasks = [
      task('a', async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'not an Error instance';
      }),
    ];

    const result = await loadSequentially(tasks).catch((error: unknown) => error);

    const aggregate = result as AggregateError;
    expect(aggregate.errors[0]).toBeInstanceOf(Error);
    expect((aggregate.errors[0] as Error).message).toBe('not an Error instance');
  });
});

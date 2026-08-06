/** One unit of loadable work — a human-readable label plus the async operation itself. */
export interface LoadTask {
  /** Shown in the loading screen while this task is in flight — e.g. "player/day/default_head". */
  name: string;
  load: () => Promise<void>;
}

export interface LoadProgress {
  /** How many tasks have finished (including the one currently reported as failed, if any). */
  loaded: number;
  total: number;
  /** The task currently in flight, or undefined once every task has settled. */
  current: string | undefined;
}

/**
 * Runs `tasks` strictly one after another (not Promise.all) and reports progress after each
 * one settles, so a loading screen can show "which asset we're loading" one at a time rather
 * than every asset appearing to load simultaneously with no visible order — this is a
 * deliberate UX choice, not a performance one (the browser's own HTTP/2 connection reuse
 * means sequential `fetch`/`Image` loads aren't meaningfully slower than firing them all at
 * once for this project's asset volume).
 *
 * A single failed task does not abort the remaining ones — every task still gets a chance to
 * load, and the returned promise rejects with an AggregateError listing every failure once all
 * tasks have settled, rather than the first failure silently stopping everything else after it
 * partway through the list.
 */
export async function loadSequentially(tasks: readonly LoadTask[], onProgress?: (progress: LoadProgress) => void): Promise<void> {
  const total = tasks.length;
  const failures: Error[] = [];

  onProgress?.({ loaded: 0, total, current: tasks[0]?.name });

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i]!;
    onProgress?.({ loaded: i, total, current: task.name });

    try {
      await task.load();
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }

    onProgress?.({ loaded: i + 1, total, current: tasks[i + 1]?.name });
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} of ${total} asset(s) failed to load`);
  }
}

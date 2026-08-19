/**
 * Next runs this once per server process at startup. It is the only place the
 * app gets a boot hook, so the cron ticker is armed here.
 *
 * Guarded on the nodejs runtime: better-sqlite3 is native and the scheduler
 * touches the database, so it must never be evaluated on the edge runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.SCHEDULER_ENABLED === '0') return;
  const { startScheduler } = await import('@/lib/scheduler-loop');
  startScheduler();
}

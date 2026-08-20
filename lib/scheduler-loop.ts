/**
 * The in-process ticker that drives the cron runner.
 *
 * Deliberately simple: one timer, aligned to the top of each minute, calling
 * runDueCrons. That is the right size for a single-operator app on one host.
 * When the workload outgrows it — long runs blocking the tick, or more than
 * one server process — this is the seam a real job queue replaces, and the
 * scheduler logic underneath stays untouched.
 *
 * Two guards that matter:
 *  - A module-level singleton, because dev-mode HMR re-evaluates modules and
 *    would otherwise stack a new timer on every reload, firing each schedule
 *    N times.
 *  - `unref()`, so a pending tick never keeps the process alive on shutdown.
 */
import { getDb } from '@/lib/data';
import { createRuntime } from '@/lib/agents/runtime';
import { runtimeRosterFor } from '@/lib/agents/roster';
import { runDueCrons } from '@/lib/scheduler';

const TICK_MS = 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __emindScheduler: { timer: NodeJS.Timeout } | undefined;
}

/**
 * One pass per user. Each gets a runtime built from their own roster, so a
 * schedule can only ever fire an agent that user installed — and a schedule
 * belonging to one person never runs on another's behalf.
 */
async function tick(): Promise<void> {
  try {
    const db = getDb();
    const now = new Date();
    let fired = 0;
    for (const user of db.users.allIds()) {
      // A scoped handle per user: the runs this fires are recorded as theirs.
      const scoped = db.withUser(user);
      const runtime = createRuntime(scoped, runtimeRosterFor(scoped, user));
      // Scheduled runs resolve that user's own credentials, exactly as a
      // manual run does — otherwise a cron would quietly use the install's.
      const { withUserSecrets } = await import('@/lib/creds');
      const { secretsFor } = await import('@/lib/vault');
      fired += await withUserSecrets(secretsFor(db, user), () =>
        runDueCrons(scoped, runtime, now, user),
      );
    }
    if (fired > 0) console.log(`[scheduler] fired ${fired} scheduled run(s)`);
  } catch (err) {
    // A broken tick must never kill the timer — the next minute gets a clean try.
    console.error('[scheduler] tick failed:', err instanceof Error ? err.message : err);
  }
}

/** Idempotent: safe to call on every module evaluation. */
export function startScheduler(): void {
  if (globalThis.__emindScheduler) return;

  // Align to the top of the next minute so firings land on the minute a human
  // wrote, not on a drifting offset from whenever the server happened to boot.
  const msToNextMinute = 60_000 - (Date.now() % 60_000);
  const timer = setTimeout(() => {
    void tick();
    const interval = setInterval(() => void tick(), TICK_MS);
    interval.unref?.();
    globalThis.__emindScheduler = { timer: interval };
  }, msToNextMinute);
  timer.unref?.();

  globalThis.__emindScheduler = { timer };
  console.log('[scheduler] armed — first tick in %ds', Math.round(msToNextMinute / 1000));
}

export function stopScheduler(): void {
  if (!globalThis.__emindScheduler) return;
  clearTimeout(globalThis.__emindScheduler.timer);
  clearInterval(globalThis.__emindScheduler.timer);
  globalThis.__emindScheduler = undefined;
}

/**
 * The cron runner. Until now `agent_crons` was a table the UI could edit and
 * nothing ever read — schedules were displayed, never fired. This closes that
 * loop.
 *
 * Design notes:
 *  - Firing is idempotent per minute. Each cron stores the minute it last
 *    fired; a tick that lands twice in the same minute (two timers, a restart,
 *    a slow run) is a no-op rather than a duplicate execution.
 *  - A cron is stamped BEFORE the agent runs, not after. If the agent throws
 *    or the process dies mid-run, the schedule must not spin on it forever;
 *    losing one firing is far better than an infinite retry loop.
 *  - Failures are never swallowed: the runtime already records every run,
 *    successful or not, so a failed scheduled run is visible in the feed.
 */
import { cronMatches, nextMinute } from '@/lib/cron';
import type { FounderDb } from '@/lib/db';
import type { AgentRuntime } from '@/lib/agents/runtime';
import type { AgentCron } from '@/lib/schemas';

/**
 * Enabled schedules matching this minute that have not already fired in it.
 * Pass a userId to get only that user's schedules — which is how the loop
 * runs them, since a schedule belongs to a person, not to the install.
 */
export function dueCrons(db: FounderDb, now: Date = new Date(), userId?: string): AgentCron[] {
  const minute = nextMinute(now);
  const crons = userId ? db.agentCrons.forUser(userId) : db.agentCrons.all();
  return crons.filter((c) => {
    if (!c.enabled) return false;
    if (!cronMatches(c.schedule, now)) return false;
    return c.lastRunAt !== minute;
  });
}

/**
 * Fire everything due and return how many were fired. Runs are sequential on
 * purpose: agent runs are synchronous work against SQLite and external APIs,
 * and a burst of parallel runs on a single-writer database buys nothing.
 */
export async function runDueCrons(
  db: FounderDb,
  runtime: AgentRuntime,
  now: Date = new Date(),
  userId?: string,
): Promise<number> {
  const due = dueCrons(db, now, userId);
  const minute = nextMinute(now);

  for (const cron of due) {
    // Stamp first — see the header note on why this order matters.
    db.agentCrons.markRan(cron.id, minute);
    try {
      await runtime.run(cron.agentId);
    } catch {
      // runtime.run already persists its own failures; an unknown agent id
      // throws here, and that must not abort the rest of the tick.
    }
  }

  return due.length;
}

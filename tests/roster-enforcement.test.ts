import { describe, expect, test, beforeEach } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { createUser } from '@/lib/auth';
import { installAgent, runtimeRosterFor } from '@/lib/agents/roster';
import { createRuntime } from '@/lib/agents/runtime';
import { runDueCrons } from '@/lib/scheduler';

let db: FounderDb;
let a: string;

beforeEach(() => {
  db = openDb(':memory:');
  seedDatabase(db);
  a = createUser(db, { email: 'a@x.co', name: 'A', password: 'pw-12345678' }).id;
});

const addCron = (id: string, agentId: string) =>
  db.agentCrons.insert({
    id, agentId, schedule: '* * * * *', description: 'every minute',
    enabled: true, createdAt: '2026-08-01T00:00:00.000Z',
  });

/**
 * Running an agent the user has not installed is not merely untidy: that
 * agent would reach for a connector key the user never supplied, which in a
 * shared install means reaching for somebody else's. The roster is the
 * boundary, so execution has to respect it.
 */
describe('only installed agents may execute', () => {
  test('the runtime built from a roster refuses an uninstalled agent', async () => {
    installAgent(db, a, 'markdown-auditor');
    const runtime = createRuntime(db, runtimeRosterFor(db, a));

    await expect(runtime.run('vector-auditor')).rejects.toThrow(/unknown agent/i);
    await expect(runtime.run('markdown-auditor')).resolves.toBeTruthy();
  });

  test('a broadcast reaches installed agents only', async () => {
    installAgent(db, a, 'markdown-auditor');
    installAgent(db, a, 'vector-auditor');
    const runtime = createRuntime(db, runtimeRosterFor(db, a));

    const result = await runtime.broadcast('status?');
    const reached = result.replies.map((r) => r.agentId).sort();
    expect(reached).toEqual(['markdown-auditor', 'vector-auditor']);
  });

  test('a schedule for an uninstalled agent fires nothing', async () => {
    addCron('c1', 'vector-auditor'); // never installed
    const runtime = createRuntime(db, runtimeRosterFor(db, a));
    const before = db.agentRuns.recent(20).length;

    await runDueCrons(db, runtime, new Date('2026-08-20T09:30:00'));

    expect(db.agentRuns.recent(20).length).toBe(before);
  });

  test('a schedule for an installed agent does fire', async () => {
    installAgent(db, a, 'markdown-auditor');
    addCron('c1', 'markdown-auditor');
    const runtime = createRuntime(db, runtimeRosterFor(db, a));

    await runDueCrons(db, runtime, new Date('2026-08-20T09:30:00'));

    expect(db.agentRuns.recent(20)[0].agentId).toBe('markdown-auditor');
  });
});

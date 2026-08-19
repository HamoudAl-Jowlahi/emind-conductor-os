import { describe, expect, test, beforeEach } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { createRuntime, type RuntimeAgent } from '@/lib/agents/runtime';
import { dueCrons, runDueCrons } from '@/lib/scheduler';

let db: FounderDb;
let ran: string[];
let agents: RuntimeAgent[];

const AT_0930 = new Date('2026-08-20T09:30:00');

beforeEach(() => {
  db = openDb(':memory:');
  ran = [];
  agents = [
    {
      id: 'alpha',
      name: 'Alpha',
      description: 'test agent',
      departmentId: 'dept-tech',
      run: async () => {
        ran.push('alpha');
        return { ok: true, summary: 'alpha ok' };
      },
    },
    {
      id: 'boom',
      name: 'Boom',
      description: 'always throws',
      departmentId: 'dept-tech',
      run: async () => {
        throw new Error('agent exploded');
      },
    },
  ];
});

const addCron = (id: string, agentId: string, schedule: string, enabled = true) =>
  db.agentCrons.insert({
    id,
    agentId,
    schedule,
    description: `${id} schedule`,
    enabled,
    createdAt: '2026-08-01T00:00:00.000Z',
  });

describe('dueCrons — which schedules fire at this minute', () => {
  test('a matching enabled cron is due', () => {
    addCron('c1', 'alpha', '30 9 * * *');
    expect(dueCrons(db, AT_0930).map((c) => c.id)).toEqual(['c1']);
  });

  test('a disabled cron never fires, however well it matches', () => {
    addCron('c1', 'alpha', '30 9 * * *', false);
    expect(dueCrons(db, AT_0930)).toEqual([]);
  });

  test('a non-matching cron is not due', () => {
    addCron('c1', 'alpha', '45 9 * * *');
    expect(dueCrons(db, AT_0930)).toEqual([]);
  });

  test('a cron already fired this minute is not due again', () => {
    addCron('c1', 'alpha', '30 9 * * *');
    db.agentCrons.markRan('c1', AT_0930.toISOString());
    expect(dueCrons(db, AT_0930)).toEqual([]);
  });

  test('the same cron is due again the next day', () => {
    addCron('c1', 'alpha', '30 9 * * *');
    db.agentCrons.markRan('c1', AT_0930.toISOString());
    expect(dueCrons(db, new Date('2026-08-21T09:30:00')).map((c) => c.id)).toEqual(['c1']);
  });
});

describe('runDueCrons — firing them', () => {
  test('runs the agent and records a run', async () => {
    addCron('c1', 'alpha', '30 9 * * *');
    const runtime = createRuntime(db, agents);
    const fired = await runDueCrons(db, runtime, AT_0930);

    expect(fired).toBe(1);
    expect(ran).toEqual(['alpha']);
    expect(db.agentRuns.recent(10)[0].agentId).toBe('alpha');
  });

  test('a second tick in the same minute does not double-fire', async () => {
    addCron('c1', 'alpha', '30 9 * * *');
    const runtime = createRuntime(db, agents);
    await runDueCrons(db, runtime, AT_0930);
    await runDueCrons(db, runtime, new Date('2026-08-20T09:30:41'));

    expect(ran).toEqual(['alpha']); // once, not twice
  });

  test('an agent that throws still stamps the cron, so it cannot loop forever', async () => {
    addCron('c1', 'boom', '30 9 * * *');
    const runtime = createRuntime(db, agents);
    const fired = await runDueCrons(db, runtime, AT_0930);

    expect(fired).toBe(1);
    // The runtime records the failure honestly rather than losing it.
    const run = db.agentRuns.recent(10)[0];
    expect(run.ok).toBe(false);
    expect(run.summary).toContain('exploded');
    // And the schedule is stamped, so the next tick this minute is a no-op.
    expect(dueCrons(db, AT_0930)).toEqual([]);
  });

  test('one failing agent does not stop the others in the same tick', async () => {
    addCron('c1', 'boom', '30 9 * * *');
    addCron('c2', 'alpha', '30 9 * * *');
    const runtime = createRuntime(db, agents);
    const fired = await runDueCrons(db, runtime, AT_0930);

    expect(fired).toBe(2);
    expect(ran).toEqual(['alpha']);
  });

  test('a cron pointing at an unknown agent is stamped, not retried forever', async () => {
    addCron('c1', 'ghost-agent', '30 9 * * *');
    const runtime = createRuntime(db, agents);
    await runDueCrons(db, runtime, AT_0930);
    expect(dueCrons(db, AT_0930)).toEqual([]);
  });

  test('nothing due is a cheap no-op', async () => {
    addCron('c1', 'alpha', '45 9 * * *');
    const runtime = createRuntime(db, agents);
    expect(await runDueCrons(db, runtime, AT_0930)).toBe(0);
    expect(ran).toEqual([]);
  });
});

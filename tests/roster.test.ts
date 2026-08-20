import { describe, expect, test, beforeEach } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { createUser } from '@/lib/auth';
import { installAgent, uninstallAgent, setAgentEnabled, rosterFor, catalogFor, runtimeRosterFor, backfillRoster } from '@/lib/agents/roster';
import { realAgents } from '@/lib/agents/real';

let db: FounderDb;
let a: string;
let b: string;

beforeEach(() => {
  db = openDb(':memory:');
  seedDatabase(db);
  a = createUser(db, { email: 'a@x.co', name: 'A', password: 'pw-12345678' }).id;
  b = createUser(db, { email: 'b@x.co', name: 'B', password: 'pw-12345678' }).id;
});

describe('install layer', () => {
  test('a fresh user starts with an empty roster — nothing is assumed', () => {
    expect(rosterFor(db, a)).toEqual([]);
  });

  test('installing puts the agent in that user roster only', () => {
    installAgent(db, a, 'markdown-auditor');
    expect(rosterFor(db, a).map((x) => x.id)).toEqual(['markdown-auditor']);
    expect(rosterFor(db, b)).toEqual([]);
  });

  test('two users keep independent rosters', () => {
    installAgent(db, a, 'markdown-auditor');
    installAgent(db, a, 'vector-auditor');
    installAgent(db, b, 'comms-agent');

    expect(rosterFor(db, a).map((x) => x.id).sort()).toEqual(['markdown-auditor', 'vector-auditor']);
    expect(rosterFor(db, b).map((x) => x.id)).toEqual(['comms-agent']);
  });

  test('installing twice is idempotent, not a duplicate', () => {
    installAgent(db, a, 'markdown-auditor');
    installAgent(db, a, 'markdown-auditor');
    expect(rosterFor(db, a)).toHaveLength(1);
  });

  test('uninstalling removes it from that user only', () => {
    installAgent(db, a, 'comms-agent');
    installAgent(db, b, 'comms-agent');
    uninstallAgent(db, a, 'comms-agent');

    expect(rosterFor(db, a)).toEqual([]);
    expect(rosterFor(db, b).map((x) => x.id)).toEqual(['comms-agent']);
  });

  test('a disabled agent stays installed but drops out of the active roster', () => {
    installAgent(db, a, 'comms-agent');
    setAgentEnabled(db, a, 'comms-agent', false);

    expect(rosterFor(db, a)).toEqual([]);
    expect(catalogFor(db, a).find((c) => c.id === 'comms-agent')?.installed).toBe(true);
    expect(catalogFor(db, a).find((c) => c.id === 'comms-agent')?.enabled).toBe(false);
  });

  test('installing an unknown agent id is refused', () => {
    expect(() => installAgent(db, a, 'no-such-agent')).toThrow(/unknown agent/i);
  });
});

describe('catalog', () => {
  test('lists every built-in agent with its install state for this user', () => {
    const cat = catalogFor(db, a);
    expect(cat).toHaveLength(realAgents.length);
    expect(cat.every((c) => c.installed === false)).toBe(true);

    installAgent(db, a, 'comms-agent');
    const after = catalogFor(db, a);
    expect(after.find((c) => c.id === 'comms-agent')?.installed).toBe(true);
    // still the full catalog — installing does not shrink what is on offer
    expect(after).toHaveLength(realAgents.length);
  });

  test('each entry declares the keys it needs, so the card can warn before install', () => {
    const slack = catalogFor(db, a).find((c) => c.id === 'slack-worker');
    expect(slack).toBeTruthy();
    expect(slack!.tools).toContain('slack');
    expect(slack!.description.length).toBeGreaterThan(0);
    expect(slack!.department.length).toBeGreaterThan(0);
  });

  test('the catalog is the same for everyone — only install state differs', () => {
    installAgent(db, a, 'comms-agent');
    expect(catalogFor(db, a).map((c) => c.id)).toEqual(catalogFor(db, b).map((c) => c.id));
  });
});

describe('runtime roster — what may actually execute', () => {
  test('returns executable agents for the installed ids only', () => {
    installAgent(db, a, 'markdown-auditor');
    const rt = runtimeRosterFor(db, a);
    expect(rt.map((x) => x.id)).toEqual(['markdown-auditor']);
    expect(typeof rt[0].run).toBe('function');
  });

  test('an empty roster can execute nothing', () => {
    expect(runtimeRosterFor(db, b)).toEqual([]);
  });

  test('a disabled agent cannot execute', () => {
    installAgent(db, a, 'markdown-auditor');
    setAgentEnabled(db, a, 'markdown-auditor', false);
    expect(runtimeRosterFor(db, a)).toEqual([]);
  });
});

/**
 * Migration behaviour. An install that predates the catalog has users who
 * already "had" all 19 agents implicitly; taking them away on upgrade would
 * be a silent regression. New users, by contrast, must start empty and choose
 * — that is the whole point of the catalog.
 */
describe('backfill for existing users', () => {
  test('backfill gives an existing user the full built-in roster', () => {
    expect(rosterFor(db, a)).toEqual([]);
    backfillRoster(db, a);
    expect(rosterFor(db, a)).toHaveLength(realAgents.length);
  });

  test('backfill is idempotent and never duplicates', () => {
    backfillRoster(db, a);
    backfillRoster(db, a);
    expect(rosterFor(db, a)).toHaveLength(realAgents.length);
  });

  test('backfill does not touch anyone else', () => {
    backfillRoster(db, a);
    expect(rosterFor(db, b)).toEqual([]);
  });

  test('backfill respects a prior uninstall — it is not a reset button', () => {
    backfillRoster(db, a);
    uninstallAgent(db, a, 'comms-agent');
    backfillRoster(db, a);
    expect(rosterFor(db, a).map((x) => x.id)).not.toContain('comms-agent');
  });
});

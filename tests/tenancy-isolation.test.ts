import { describe, expect, test, beforeEach } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { createUser } from '@/lib/auth';
import { forUser } from '@/lib/db-scoped';
import { OWNED_TABLES } from '@/lib/tenancy';

let db: FounderDb;
let aId: string;
let bId: string;

beforeEach(() => {
  db = openDb(':memory:');
  seedDatabase(db);
  aId = createUser(db, { email: 'a@x.co', name: 'A', password: 'pw-12345678' }).id;
  bId = createUser(db, { email: 'b@x.co', name: 'B', password: 'pw-12345678' }).id;
  db.claimOrphanRows(aId); // seeded rows belong to the first user
});

/**
 * The multi-user model rests on these. A scoped handle must be UNABLE to see
 * another user's rows — not "does not by convention", but cannot, because the
 * filter lives in the repository instead of in each caller.
 */
describe('a scoped handle sees only its own rows', () => {
  test('agent runs do not cross', () => {
    forUser(db, aId).agentRuns.insert({
      id: 'run-a', agentId: 'markdown-auditor', startedAt: '2026-08-20T09:00:00.000Z',
      finishedAt: '2026-08-20T09:00:01.000Z', ok: true, summary: 'A only',
    });
    expect(forUser(db, aId).agentRuns.recent(10).map((r) => r.id)).toContain('run-a');
    expect(forUser(db, bId).agentRuns.recent(10)).toEqual([]);
  });

  test('agent messages do not cross — these are private conversations', () => {
    forUser(db, aId).agentMessages.insert({
      id: 'm1', agentId: 'data-agent', role: 'user', content: 'A private question',
      toolCalls: [], createdAt: '2026-08-20T09:00:00.000Z',
    });
    expect(forUser(db, aId).agentMessages.byAgent('data-agent')).toHaveLength(1);
    expect(forUser(db, bId).agentMessages.byAgent('data-agent')).toEqual([]);
  });

  test('the funnel does not cross — these are real clients', () => {
    expect(forUser(db, aId).funnel.journeys().length).toBeGreaterThan(0);
    expect(forUser(db, bId).funnel.journeys()).toEqual([]);
  });

  test('metrics, workflows, people and SOPs do not cross', () => {
    const a = forUser(db, aId);
    const b = forUser(db, bId);
    expect(a.metrics.all().length).toBeGreaterThan(0);
    expect(b.metrics.all()).toEqual([]);
    expect(a.workflows.all().length).toBeGreaterThan(0);
    expect(b.workflows.all()).toEqual([]);
    expect(a.people.all().length).toBeGreaterThan(0);
    expect(b.people.all()).toEqual([]);
    expect(a.sopTasks.all().length).toBeGreaterThan(0);
    expect(b.sopTasks.all()).toEqual([]);
  });

  test('social data does not cross', () => {
    expect(forUser(db, aId).social.accounts().length).toBeGreaterThan(0);
    expect(forUser(db, bId).social.accounts()).toEqual([]);
  });

  test('the shared catalog IS visible to everyone — scoping it would hide the product', () => {
    const b = forUser(db, bId);
    expect(b.agents.all().length).toBeGreaterThan(0);
    expect(b.departments.all().length).toBeGreaterThan(0);
    expect(b.tools.all().length).toBeGreaterThan(0);
  });
});

describe('writes carry the owner automatically', () => {
  test('an insert through a scoped handle belongs to that handle', () => {
    forUser(db, bId).agentRuns.insert({
      id: 'run-b', agentId: 'markdown-auditor', startedAt: '2026-08-20T09:00:00.000Z',
      finishedAt: '2026-08-20T09:00:01.000Z', ok: true, summary: 'B',
    });
    const row = db.raw.prepare('SELECT user_id FROM agent_runs WHERE id = ?').get('run-b') as { user_id: string };
    expect(row.user_id).toBe(bId);
  });

  test('the unscoped handle still sees everything — seeding and the scheduler need it', () => {
    forUser(db, bId).agentRuns.insert({
      id: 'run-b2', agentId: 'markdown-auditor', startedAt: '2026-08-20T09:00:00.000Z',
      finishedAt: '2026-08-20T09:00:01.000Z', ok: true, summary: 'B',
    });
    expect(db.agentRuns.recent(50).map((r) => r.id)).toContain('run-b2');
  });
});

/**
 * The static guard. Reviewing 58 statements by eye once proves nothing about
 * the 59th, so this reads the source: every query touching an owned table must
 * reference user_id, whether by the scope helpers or by naming the column.
 */
describe('no owned-table query escapes the scope', () => {
  test('every prepared statement on an owned table references its owner', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'lib/db.ts'), 'utf8');

    const statements = [...src.matchAll(/prepare\(\s*([`'])((?:.|\n)*?)\1/g)].map((m) => m[2]);
    const offenders: string[] = [];

    for (const sql of statements) {
      const table = OWNED_TABLES.find((t) => new RegExp(`\b${t}\b`).test(sql));
      if (!table) continue;
      // Either the scope helpers were interpolated, or user_id is named outright.
      const scoped = /\$\{scope(Where)?\(\)\}/.test(sql) || /user_id/.test(sql);
      if (!scoped) offenders.push(`${table}: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
    }

    expect(offenders, `unscoped queries found:\n${offenders.join('\n')}`).toEqual([]);
  });
});

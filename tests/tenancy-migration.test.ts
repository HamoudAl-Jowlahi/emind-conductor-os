import { describe, expect, test, beforeEach } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { createUser } from '@/lib/auth';
import { OWNED_TABLES } from '@/lib/tenancy';

let db: FounderDb;
beforeEach(() => {
  db = openDb(':memory:');
  seedDatabase(db);
});

const columns = (table: string): string[] =>
  (db.raw.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);

describe('owned tables carry an owner', () => {
  test.each(OWNED_TABLES)('%s has a user_id column', (table) => {
    expect(columns(table)).toContain('user_id');
  });

  test('an index exists on user_id so scoped reads stay cheap', () => {
    for (const table of OWNED_TABLES) {
      const idx = db.raw.pragma(`index_list(${table})`) as { name: string }[];
      const names = idx.map((i) => i.name);
      expect(names.some((n) => n.includes('user')), `${table} needs a user_id index`).toBe(true);
    }
  });
});

describe('backfill', () => {
  test('rows that predate multi-user are assigned to the first user', () => {
    // Seeded rows exist before any user does — that is the upgrade case.
    const owner = createUser(db, { email: 'owner@x.co', name: 'Owner', password: 'pw-12345678' });
    db.claimOrphanRows(owner.id);

    const orphans = db.raw
      .prepare(`SELECT COUNT(*) AS n FROM metrics WHERE user_id IS NULL`)
      .get() as { n: number };
    expect(orphans.n).toBe(0);

    const mine = db.raw
      .prepare(`SELECT COUNT(*) AS n FROM metrics WHERE user_id = ?`)
      .get(owner.id) as { n: number };
    expect(mine.n).toBeGreaterThan(0);
  });

  test('claiming is a one-time upgrade — a second user inherits nothing', () => {
    const a = createUser(db, { email: 'a@x.co', name: 'A', password: 'pw-12345678' });
    db.claimOrphanRows(a.id);
    const b = createUser(db, { email: 'b@x.co', name: 'B', password: 'pw-12345678' });
    db.claimOrphanRows(b.id);

    const bRows = db.raw
      .prepare(`SELECT COUNT(*) AS n FROM metrics WHERE user_id = ?`)
      .get(b.id) as { n: number };
    expect(bRows.n).toBe(0);
  });
});

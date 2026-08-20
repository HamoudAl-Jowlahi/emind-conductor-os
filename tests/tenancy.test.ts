import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SHARED_TABLES, IDENTITY_TABLES, OWNED_TABLES, ALL_CLASSIFIED } from '@/lib/tenancy';

const schemaTables = (): string[] => {
  const src = readFileSync(join(process.cwd(), 'lib/db.ts'), 'utf8');
  return [...src.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map((m) => m[1]);
};

describe('tenancy classification', () => {
  test('every table in the schema is classified exactly once', () => {
    const tables = schemaTables().sort();
    const classified = [...ALL_CLASSIFIED].sort();

    // A table nobody classified is the dangerous case: it would be read
    // unscoped and quietly serve one user's rows to another.
    expect(classified).toEqual(tables);
  });

  test('no table is in two lists', () => {
    expect(new Set(ALL_CLASSIFIED).size).toBe(ALL_CLASSIFIED.length);
  });

  test('the obviously-personal tables are owned, not shared', () => {
    for (const t of ['agent_runs', 'agent_messages', 'funnel_contacts', 'metrics']) {
      expect(OWNED_TABLES as readonly string[]).toContain(t);
      expect(SHARED_TABLES as readonly string[]).not.toContain(t);
    }
  });

  test('the catalog stays shared — scoping it would hide the product', () => {
    for (const t of ['agents', 'departments', 'tools']) {
      expect(SHARED_TABLES as readonly string[]).toContain(t);
      expect(OWNED_TABLES as readonly string[]).not.toContain(t);
    }
  });

  test('identity tables carry ownership by construction', () => {
    expect(IDENTITY_TABLES as readonly string[]).toContain('users');
    expect(IDENTITY_TABLES as readonly string[]).toContain('user_agents');
  });
});

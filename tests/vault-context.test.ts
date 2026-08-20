import { describe, expect, test, beforeEach, afterAll } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { createUser } from '@/lib/auth';
import { putSecret, secretsFor, ROOT_KEY_ENV } from '@/lib/vault';
import { withUserSecrets, runtimeEnv, resolveCred, contextSecrets } from '@/lib/creds';

const prev = process.env[ROOT_KEY_ENV];
process.env[ROOT_KEY_ENV] = 'd'.repeat(64);
afterAll(() => {
  if (prev === undefined) delete process.env[ROOT_KEY_ENV];
  else process.env[ROOT_KEY_ENV] = prev;
});

let db: FounderDb;
let a: string;
let b: string;
beforeEach(() => {
  db = openDb(':memory:');
  a = createUser(db, { email: 'a@x.co', name: 'A', password: 'pw-12345678' }).id;
  b = createUser(db, { email: 'b@x.co', name: 'B', password: 'pw-12345678' }).id;
});

/**
 * This is the acceptance criterion for the whole task: an agent must run on
 * ITS OWNER'S key. Connectors resolve through lib/creds, so proving the
 * resolvers honour the context proves it for every connector at once.
 */
describe('credential context decides which key a connector sees', () => {
  test('each user resolves their own value for the same name', () => {
    putSecret(db, a, 'STRIPE_SECRET_KEY', 'sk_test_AAA');
    putSecret(db, b, 'STRIPE_SECRET_KEY', 'sk_test_BBB');

    const seenByA = withUserSecrets(secretsFor(db, a), () => runtimeEnv().STRIPE_SECRET_KEY);
    const seenByB = withUserSecrets(secretsFor(db, b), () => runtimeEnv().STRIPE_SECRET_KEY);

    expect(seenByA).toBe('sk_test_AAA');
    expect(seenByB).toBe('sk_test_BBB');
  });

  test('resolveCred honours the context too — connectors that use it are covered', () => {
    putSecret(db, a, 'NOTION_API_KEY', 'ntn_AAA');
    const seen = withUserSecrets(secretsFor(db, a), () => resolveCred('NOTION_API_KEY', []));
    expect(seen).toBe('ntn_AAA');
  });

  test("a user's key beats an install-level env value", () => {
    process.env.TEST_SHARED_KEY = 'install-level';
    putSecret(db, a, 'TEST_SHARED_KEY', 'the-user-own');
    try {
      expect(runtimeEnv().TEST_SHARED_KEY).toBe('install-level'); // no context
      const seen = withUserSecrets(secretsFor(db, a), () => runtimeEnv().TEST_SHARED_KEY);
      expect(seen).toBe('the-user-own');
    } finally {
      delete process.env.TEST_SHARED_KEY;
    }
  });

  test('the context does not leak out of its callback', () => {
    putSecret(db, a, 'LEAK_CHECK_KEY', 'inside-only');
    withUserSecrets(secretsFor(db, a), () => {
      expect(contextSecrets().LEAK_CHECK_KEY).toBe('inside-only');
    });
    expect(contextSecrets().LEAK_CHECK_KEY).toBeUndefined();
  });

  test('the context survives an await — connectors are async', async () => {
    putSecret(db, a, 'ASYNC_CHECK_KEY', 'still-here');
    const seen = await withUserSecrets(secretsFor(db, a), async () => {
      await new Promise((r) => setTimeout(r, 5));
      return runtimeEnv().ASYNC_CHECK_KEY;
    });
    expect(seen).toBe('still-here');
  });

  test('no context means install-level env — seeding and scripts still work', () => {
    process.env.TEST_NO_CTX = 'from-install';
    try {
      expect(runtimeEnv().TEST_NO_CTX).toBe('from-install');
    } finally {
      delete process.env.TEST_NO_CTX;
    }
  });
});

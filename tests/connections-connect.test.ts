import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { signInTestUser } from './helpers/session';

const ROOT_KEY = 'c'.repeat(64);
const prevRoot = process.env.CREDENTIALS_KEY;

/**
 * The connect flow writes to the caller's ENCRYPTED VAULT — never to a file the
 * whole install shares, and never into the repo. The shared file held one value
 * per key name, so on a multi-user install the second person to save a Stripe
 * key silently overwrote the first person's.
 */
beforeAll(() => {
  process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'connect-')), 'test.db');
  process.env.CREDENTIALS_KEY = ROOT_KEY;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env.CREDENTIALS_KEY;
  else process.env.CREDENTIALS_KEY = prevRoot;
});

let userId: string;
beforeEach(async () => {
  vi.resetModules();
  const { user } = await signInTestUser({ email: 'connect@example.com', name: 'Connect' });
  userId = user.id;
});

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/connections/connect/route');
  return POST(new Request('http://test/api/connections/connect', { method: 'POST', body: JSON.stringify(body) }));
};
const del = async (body: unknown) => {
  const { DELETE } = await import('@/app/api/connections/connect/route');
  return DELETE(new Request('http://test/api/connections/connect', { method: 'DELETE', body: JSON.stringify(body) }));
};
const vault = async () => {
  const { getDb } = await import('@/lib/data');
  const { listSecretNames, getSecret } = await import('@/lib/vault');
  return { db: getDb(), listSecretNames, getSecret };
};

describe('POST /api/connections/connect', () => {
  test('stores the key in the vault and reports keySaved without echoing the value', async () => {
    const res = await post({ slug: 'notion', values: { NOTION_API_KEY: 'ntn_secret_123' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.keySaved).toBe(true);
    // The response must never carry the secret back to the browser.
    expect(JSON.stringify(body)).not.toContain('ntn_secret_123');

    const { db, getSecret } = await vault();
    expect(getSecret(db, userId, 'NOTION_API_KEY')).toBe('ntn_secret_123');
  });

  test('the stored row is ciphertext, not the key', async () => {
    await post({ slug: 'notion', values: { NOTION_API_KEY: 'ntn_plaintext_canary' } });
    const { db } = await vault();
    const rows = db.raw.prepare('SELECT * FROM user_credentials').all();
    expect(JSON.stringify(rows)).not.toContain('ntn_plaintext_canary');
  });

  test('refuses a key name the integration does not declare', async () => {
    const res = await post({ slug: 'notion', values: { SOME_OTHER_KEY: 'nope' } });
    expect(res.status).toBe(400);
  });

  test('refuses an unknown integration', async () => {
    const res = await post({ slug: 'not-a-real-integration', values: { X: 'y' } });
    expect(res.status).toBe(400);
  });

  test('DELETE removes exactly that integration keys', async () => {
    await post({ slug: 'notion', values: { NOTION_API_KEY: 'ntn_secret_123' } });
    const res = await del({ slug: 'notion' });
    expect(res.status).toBe(200);

    const { db, getSecret } = await vault();
    expect(getSecret(db, userId, 'NOTION_API_KEY')).toBeUndefined();
  });

  test('two users keep independent keys for the same integration', async () => {
    await post({ slug: 'notion', values: { NOTION_API_KEY: 'ntn_FIRST' } });

    vi.resetModules();
    const { user: second } = await signInTestUser({ email: 'second@example.com', name: 'Second' });
    await post({ slug: 'notion', values: { NOTION_API_KEY: 'ntn_SECOND' } });

    const { db, getSecret } = await vault();
    expect(getSecret(db, userId, 'NOTION_API_KEY')).toBe('ntn_FIRST');
    expect(getSecret(db, second.id, 'NOTION_API_KEY')).toBe('ntn_SECOND');
  });
});

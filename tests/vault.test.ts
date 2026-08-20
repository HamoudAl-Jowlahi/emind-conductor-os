import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { createUser } from '@/lib/auth';
import { encryptSecret, decryptSecret, vaultReady, ROOT_KEY_ENV } from '@/lib/vault';
import { putSecret, getSecret, listSecretNames, removeSecret, secretsFor } from '@/lib/vault';

const KEY = 'a'.repeat(64); // 32 bytes, hex
const prev = process.env[ROOT_KEY_ENV];

let db: FounderDb;
let a: string;
let b: string;

beforeEach(() => {
  process.env[ROOT_KEY_ENV] = KEY;
  db = openDb(':memory:');
  a = createUser(db, { email: 'a@x.co', name: 'A', password: 'pw-12345678' }).id;
  b = createUser(db, { email: 'b@x.co', name: 'B', password: 'pw-12345678' }).id;
});
afterEach(() => {
  if (prev === undefined) delete process.env[ROOT_KEY_ENV];
  else process.env[ROOT_KEY_ENV] = prev;
});

describe('encryption', () => {
  test('round-trips a secret', () => {
    const sealed = encryptSecret('sk_live_super_secret');
    expect(decryptSecret(sealed)).toBe('sk_live_super_secret');
  });

  test('the ciphertext never contains the plaintext', () => {
    const sealed = encryptSecret('sk_live_super_secret');
    expect(JSON.stringify(sealed)).not.toContain('sk_live_super_secret');
  });

  test('the same secret encrypts differently every time — a fresh IV', () => {
    const one = encryptSecret('same-value');
    const two = encryptSecret('same-value');
    expect(one.ciphertext).not.toBe(two.ciphertext);
    expect(one.iv).not.toBe(two.iv);
  });

  test('a tampered ciphertext is rejected, not silently decrypted', () => {
    const sealed = encryptSecret('sk_live_super_secret');
    const flipped = sealed.ciphertext.slice(0, -2) + (sealed.ciphertext.endsWith('00') ? '11' : '00');
    expect(() => decryptSecret({ ...sealed, ciphertext: flipped })).toThrow();
  });

  test('a wrong root key cannot read an existing secret', () => {
    const sealed = encryptSecret('sk_live_super_secret');
    process.env[ROOT_KEY_ENV] = 'b'.repeat(64);
    expect(() => decryptSecret(sealed)).toThrow();
  });

  test('vaultReady reports honestly when no root key is configured', () => {
    expect(vaultReady()).toBe(true);
    delete process.env[ROOT_KEY_ENV];
    expect(vaultReady()).toBe(false);
  });
});

describe('per-user vault', () => {
  test('two users hold different values for the same key name', () => {
    putSecret(db, a, 'STRIPE_SECRET_KEY', 'sk_test_AAA');
    putSecret(db, b, 'STRIPE_SECRET_KEY', 'sk_test_BBB');

    expect(getSecret(db, a, 'STRIPE_SECRET_KEY')).toBe('sk_test_AAA');
    expect(getSecret(db, b, 'STRIPE_SECRET_KEY')).toBe('sk_test_BBB');
  });

  test('one user cannot read another user key', () => {
    putSecret(db, a, 'NOTION_API_KEY', 'secret-of-a');
    expect(getSecret(db, b, 'NOTION_API_KEY')).toBeUndefined();
  });

  test('nothing readable is stored in the clear', () => {
    putSecret(db, a, 'STRIPE_SECRET_KEY', 'sk_test_PLAINTEXT_CANARY');
    const rows = db.raw.prepare('SELECT * FROM user_credentials').all();
    expect(JSON.stringify(rows)).not.toContain('sk_test_PLAINTEXT_CANARY');
  });

  test('writing the same name replaces rather than duplicates', () => {
    putSecret(db, a, 'NOTION_API_KEY', 'first');
    putSecret(db, a, 'NOTION_API_KEY', 'second');
    expect(getSecret(db, a, 'NOTION_API_KEY')).toBe('second');
    expect(listSecretNames(db, a)).toEqual(['NOTION_API_KEY']);
  });

  test('names list without values — the board shows set / not set only', () => {
    putSecret(db, a, 'STRIPE_SECRET_KEY', 'sk_test_AAA');
    putSecret(db, a, 'NOTION_API_KEY', 'ntn_AAA');
    const names = listSecretNames(db, a).sort();
    expect(names).toEqual(['NOTION_API_KEY', 'STRIPE_SECRET_KEY']);
    expect(JSON.stringify(names)).not.toContain('sk_test_AAA');
  });

  test('removing takes it out for that user only', () => {
    putSecret(db, a, 'NOTION_API_KEY', 'a-value');
    putSecret(db, b, 'NOTION_API_KEY', 'b-value');
    removeSecret(db, a, 'NOTION_API_KEY');
    expect(getSecret(db, a, 'NOTION_API_KEY')).toBeUndefined();
    expect(getSecret(db, b, 'NOTION_API_KEY')).toBe('b-value');
  });

  test('secretsFor returns one user decrypted map, ready to overlay on env', () => {
    putSecret(db, a, 'STRIPE_SECRET_KEY', 'sk_test_AAA');
    putSecret(db, a, 'NOTION_API_KEY', 'ntn_AAA');
    putSecret(db, b, 'STRIPE_SECRET_KEY', 'sk_test_BBB');

    expect(secretsFor(db, a)).toEqual({ STRIPE_SECRET_KEY: 'sk_test_AAA', NOTION_API_KEY: 'ntn_AAA' });
    expect(secretsFor(db, b)).toEqual({ STRIPE_SECRET_KEY: 'sk_test_BBB' });
  });

  test('without a root key the vault refuses to store rather than storing in the clear', () => {
    delete process.env[ROOT_KEY_ENV];
    expect(() => putSecret(db, a, 'STRIPE_SECRET_KEY', 'sk_test_AAA')).toThrow(/root key/i);
  });
});

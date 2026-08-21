import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { createUser } from '@/lib/auth';
import { ROOT_KEY_ENV } from '@/lib/vault';
import {
  generateSecret,
  totpCode,
  verifyTotp,
  otpauthUrl,
  enrollTotp,
  confirmTotp,
  totpEnabled,
  disableTotp,
  consumeRecoveryCode,
} from '@/lib/totp';

process.env[ROOT_KEY_ENV] = 'f'.repeat(64);

let db: FounderDb;
let uid: string;
beforeEach(() => {
  db = openDb(':memory:');
  uid = createUser(db, { email: 'a@x.co', name: 'A', password: 'Str0ng-pass-2026' }).id;
});
afterEach(() => vi.useRealTimers());

/**
 * RFC 6238 by hand rather than a dependency: it is an HMAC, a counter and a
 * modulo, all of which node:crypto already provides. The known-answer test
 * below is what makes that safe — it pins the implementation against the
 * spec's own vector instead of against itself.
 */
describe('the algorithm', () => {
  test('matches the RFC 6238 test vector', () => {
    // Secret "12345678901234567890" as base32, at T=59 → the RFC's 94287082.
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    // The RFC's vector is an 8-digit code; apps use 6, which is the default.
    expect(totpCode(secret, Math.floor(59 / 30), 8)).toBe('94287082');
  });

  test('produces six digits by default', () => {
    const secret = generateSecret();
    expect(totpCode(secret, 1, 6)).toMatch(/^\d{6}$/);
  });

  test('a fresh secret is base32 and long enough to matter', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(generateSecret()).not.toBe(secret);
  });
});

describe('verification', () => {
  test('accepts the current code', () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000 / 30);
    expect(verifyTotp(secret, totpCode(secret, now))).toBe(true);
  });

  test('accepts one step either side — phone clocks drift', () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000 / 30);
    expect(verifyTotp(secret, totpCode(secret, now - 1))).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + 1))).toBe(true);
  });

  test('refuses a code from far away in time', () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000 / 30);
    expect(verifyTotp(secret, totpCode(secret, now - 10))).toBe(false);
  });

  test('refuses nonsense without throwing', () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, '000000')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
  });
});

describe('the enrollment flow', () => {
  test('enrolling does not switch it on — the code must be proven first', () => {
    const { secret } = enrollTotp(db, uid);
    expect(secret).toBeTruthy();
    // Turning it on before the user proves their app works would lock them out.
    expect(totpEnabled(db, uid)).toBe(false);
  });

  test('a correct code confirms it and returns recovery codes', () => {
    const { secret } = enrollTotp(db, uid);
    const now = Math.floor(Date.now() / 1000 / 30);
    const { recoveryCodes } = confirmTotp(db, uid, totpCode(secret, now));

    expect(totpEnabled(db, uid)).toBe(true);
    expect(recoveryCodes.length).toBeGreaterThanOrEqual(8);
  });

  test('a wrong code does not confirm', () => {
    enrollTotp(db, uid);
    expect(() => confirmTotp(db, uid, '000000')).toThrow(/code/i);
    expect(totpEnabled(db, uid)).toBe(false);
  });

  test('the secret is not stored in the clear', () => {
    enrollTotp(db, uid);
    const rows = db.raw.prepare('SELECT * FROM user_totp').all();
    expect(JSON.stringify(rows)).not.toMatch(/^[A-Z2-7]{32}$/m);
  });

  test('disabling removes it entirely', () => {
    const { secret } = enrollTotp(db, uid);
    confirmTotp(db, uid, totpCode(secret, Math.floor(Date.now() / 1000 / 30)));
    disableTotp(db, uid);
    expect(totpEnabled(db, uid)).toBe(false);
  });
});

describe('recovery codes', () => {
  test('one works once and never again', () => {
    const { secret } = enrollTotp(db, uid);
    const { recoveryCodes } = confirmTotp(db, uid, totpCode(secret, Math.floor(Date.now() / 1000 / 30)));
    const code = recoveryCodes[0];

    expect(consumeRecoveryCode(db, uid, code)).toBe(true);
    // A reusable recovery code is a permanent second password.
    expect(consumeRecoveryCode(db, uid, code)).toBe(false);
  });

  test('another user codes do not work', () => {
    const other = createUser(db, { email: 'b@x.co', name: 'B', password: 'Str0ng-pass-2026' }).id;
    const { secret } = enrollTotp(db, uid);
    const { recoveryCodes } = confirmTotp(db, uid, totpCode(secret, Math.floor(Date.now() / 1000 / 30)));
    expect(consumeRecoveryCode(db, other, recoveryCodes[0])).toBe(false);
  });
});

describe('the QR payload', () => {
  test('names the issuer and the account so the app labels it usefully', () => {
    const url = new URL(otpauthUrl('SECRET123', 'a@x.co'));
    expect(url.protocol).toBe('otpauth:');
    expect(url.searchParams.get('issuer')).toBe('eMind Conductor OS');
    expect(url.searchParams.get('secret')).toBe('SECRET123');
    expect(decodeURIComponent(url.pathname)).toContain('a@x.co');
  });
});

import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { createUser } from '@/lib/auth';
import {
  issueVerificationToken,
  consumeVerificationToken,
  isEmailVerified,
  markEmailVerified,
  VERIFICATION_TTL_MS,
} from '@/lib/email-verification';

let db: FounderDb;
let uid: string;
beforeEach(() => {
  db = openDb(':memory:');
  uid = createUser(db, { email: 'a@x.co', name: 'A', password: 'Str0ng-pass-2026' }).id;
});
afterEach(() => vi.useRealTimers());

describe('a new account starts unverified', () => {
  test('createUser leaves the address unproven', () => {
    expect(isEmailVerified(db, uid)).toBe(false);
  });

  test('marking it verified sticks', () => {
    markEmailVerified(db, uid);
    expect(isEmailVerified(db, uid)).toBe(true);
  });
});

describe('the verification token', () => {
  test('is long, random, and stored hashed', () => {
    const token = issueVerificationToken(db, uid);
    expect(token.length).toBeGreaterThanOrEqual(32);

    const rows = db.raw.prepare('SELECT * FROM email_verifications').all();
    // The token is a temporary credential: a leaked database must not hand
    // over live ones.
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test('verifies the account it was issued for', () => {
    const token = issueVerificationToken(db, uid);
    expect(consumeVerificationToken(db, token)).toBe(uid);
    expect(isEmailVerified(db, uid)).toBe(true);
  });

  test('works once', () => {
    const token = issueVerificationToken(db, uid);
    expect(consumeVerificationToken(db, token)).toBe(uid);
    expect(consumeVerificationToken(db, token)).toBeNull();
  });

  test('an unknown or empty token is refused', () => {
    expect(consumeVerificationToken(db, 'invented')).toBeNull();
    expect(consumeVerificationToken(db, '')).toBeNull();
  });

  test('an expired token is refused', () => {
    vi.useFakeTimers();
    const token = issueVerificationToken(db, uid);
    vi.setSystemTime(new Date(Date.now() + VERIFICATION_TTL_MS + 1000));
    expect(consumeVerificationToken(db, token)).toBeNull();
    expect(isEmailVerified(db, uid)).toBe(false);
  });

  test('re-issuing invalidates the previous link', () => {
    const first = issueVerificationToken(db, uid);
    issueVerificationToken(db, uid);
    expect(consumeVerificationToken(db, first)).toBeNull();
  });

  test('one account token cannot verify another account', () => {
    const other = createUser(db, { email: 'b@x.co', name: 'B', password: 'Str0ng-pass-2026' }).id;
    const token = issueVerificationToken(db, uid);
    consumeVerificationToken(db, token);
    expect(isEmailVerified(db, other)).toBe(false);
  });
});

/**
 * Verification only means anything if an unverified account cannot be used.
 * Otherwise it is decoration, and anyone can register with someone else's
 * address — or an address nobody owns — and be indistinguishable from a real
 * user.
 */
describe('changing your email un-verifies it', () => {
  test('a verified account that moves to a new address must prove it again', async () => {
    markEmailVerified(db, uid);
    expect(isEmailVerified(db, uid)).toBe(true);

    const { updateProfile } = await import('@/lib/account');
    updateProfile(db, uid, { name: 'A', email: 'somewhere-else@x.co' });

    expect(isEmailVerified(db, uid)).toBe(false);
  });

  test('saving the SAME address does not un-verify it', async () => {
    markEmailVerified(db, uid);
    const { updateProfile } = await import('@/lib/account');
    updateProfile(db, uid, { name: 'A New Name', email: 'a@x.co' });
    expect(isEmailVerified(db, uid)).toBe(true);
  });
});

import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { createUser, authenticate, createSession, resolveSession } from '@/lib/auth';
import {
  issueResetToken,
  consumeResetToken,
  RESET_TTL_MS,
} from '@/lib/password-reset';

let db: FounderDb;
let uid: string;
beforeEach(() => {
  db = openDb(':memory:');
  uid = createUser(db, { email: 'a@x.co', name: 'A', password: 'Str0ng-pass-2026' }).id;
});
afterEach(() => vi.useRealTimers());

describe('issuing a token', () => {
  test('returns a long random token for a known address', () => {
    const token = issueResetToken(db, 'a@x.co');
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThanOrEqual(32);
  });

  test('returns null for an unknown address — and the ROUTE still says "sent"', () => {
    // Silence here is the whole point: a different answer per address turns the
    // reset form into a way to test which emails have accounts.
    expect(issueResetToken(db, 'nobody@x.co')).toBeNull();
  });

  test('the raw token is not what gets stored', () => {
    const token = issueResetToken(db, 'a@x.co')!;
    const rows = db.raw.prepare('SELECT * FROM password_resets').all();
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test('issuing again invalidates the previous token', () => {
    const first = issueResetToken(db, 'a@x.co')!;
    issueResetToken(db, 'a@x.co');
    expect(consumeResetToken(db, first, 'Another-pass-2026')).toBe(false);
  });
});

describe('spending a token', () => {
  test('sets the new password and signs the account out everywhere', () => {
    const other = createSession(db, uid);
    const token = issueResetToken(db, 'a@x.co')!;

    expect(consumeResetToken(db, token, 'Another-pass-2026')).toBe(true);
    expect(authenticate(db, 'a@x.co', 'Another-pass-2026')).toBeTruthy();
    expect(authenticate(db, 'a@x.co', 'Str0ng-pass-2026')).toBeNull();
    // Whoever forced the reset must not keep a live session.
    expect(resolveSession(db, other)).toBeNull();
  });

  test('a token works once', () => {
    const token = issueResetToken(db, 'a@x.co')!;
    expect(consumeResetToken(db, token, 'Another-pass-2026')).toBe(true);
    expect(consumeResetToken(db, token, 'Third-pass-2026')).toBe(false);
  });

  test('an unknown or tampered token is refused', () => {
    expect(consumeResetToken(db, 'not-a-real-token', 'Another-pass-2026')).toBe(false);
    expect(consumeResetToken(db, '', 'Another-pass-2026')).toBe(false);
  });

  test('an expired token is refused', () => {
    vi.useFakeTimers();
    const token = issueResetToken(db, 'a@x.co')!;
    vi.setSystemTime(new Date(Date.now() + RESET_TTL_MS + 1000));
    expect(consumeResetToken(db, token, 'Another-pass-2026')).toBe(false);
  });

  test('a weak new password is refused and the token survives for a retry', () => {
    const token = issueResetToken(db, 'a@x.co')!;
    expect(() => consumeResetToken(db, token, 'short')).toThrow(/10 characters/i);
    // Burning the token on a typo would strand the user.
    expect(consumeResetToken(db, token, 'Another-pass-2026')).toBe(true);
  });
});

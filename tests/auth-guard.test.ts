import { describe, expect, test, beforeEach, vi, afterEach } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { createUser } from '@/lib/auth';
import {
  recordAuthEvent,
  recentFailures,
  loginBlocked,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  passwordProblem,
  MIN_PASSWORD_LENGTH,
} from '@/lib/auth-guard';

let db: FounderDb;
beforeEach(() => {
  db = openDb(':memory:');
  createUser(db, { email: 'a@x.co', name: 'A', password: 'Str0ng-pass-2026' });
});
afterEach(() => vi.useRealTimers());

/**
 * Every attempt is recorded, successful or not. It is the rate limiter's
 * memory, the answer to "was that me?", and later the owner dashboard's data.
 */
describe('the audit trail', () => {
  test('records a failure with its context and never the password', () => {
    recordAuthEvent(db, { event: 'login_failed', email: 'a@x.co', ip: '203.0.113.9', userAgent: 'curl/8' });
    const rows = db.authEvents.recent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe('login_failed');
    expect(rows[0].ip).toBe('203.0.113.9');
    expect(JSON.stringify(rows)).not.toContain('Str0ng-pass-2026');
  });

  test('records a success against the user id', () => {
    const id = db.users.byEmail('a@x.co')!.user.id;
    recordAuthEvent(db, { event: 'login_ok', email: 'a@x.co', userId: id, ip: '1.2.3.4' });
    expect(db.authEvents.byUser(id)[0].event).toBe('login_ok');
  });

  test('a failure for an unknown email is still recorded — that is the attack', () => {
    recordAuthEvent(db, { event: 'login_failed', email: 'nobody@x.co', ip: '1.2.3.4' });
    expect(db.authEvents.recent(10)).toHaveLength(1);
  });
});

describe('login rate limiting', () => {
  const failTimes = (n: number, email = 'a@x.co', ip = '1.2.3.4') => {
    for (let i = 0; i < n; i++) recordAuthEvent(db, { event: 'login_failed', email, ip });
  };

  test('allows an honest mistake', () => {
    failTimes(LOGIN_MAX_FAILURES - 1);
    expect(loginBlocked(db, 'a@x.co', '1.2.3.4')).toBe(false);
  });

  test('blocks once the failures pile up', () => {
    failTimes(LOGIN_MAX_FAILURES);
    expect(loginBlocked(db, 'a@x.co', '1.2.3.4')).toBe(true);
  });

  test('blocks by IP too — an attacker spraying many emails from one host', () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      recordAuthEvent(db, { event: 'login_failed', email: `victim${i}@x.co`, ip: '9.9.9.9' });
    }
    // A brand new email from that same host is already suspect.
    expect(loginBlocked(db, 'fresh@x.co', '9.9.9.9')).toBe(true);
  });

  test('one attacker cannot lock a victim out from a different address', () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      recordAuthEvent(db, { event: 'login_failed', email: 'a@x.co', ip: '6.6.6.6' });
    }
    // The victim signing in from their own machine must still get through.
    expect(loginBlocked(db, 'a@x.co', '1.1.1.1')).toBe(false);
  });

  test('the block expires — a lockout is a delay, not a permanent ban', () => {
    vi.useFakeTimers();
    failTimes(LOGIN_MAX_FAILURES);
    expect(loginBlocked(db, 'a@x.co', '1.2.3.4')).toBe(true);

    vi.setSystemTime(new Date(Date.now() + LOGIN_WINDOW_MS + 1000));
    expect(loginBlocked(db, 'a@x.co', '1.2.3.4')).toBe(false);
  });

  test('a success clears the slate', () => {
    failTimes(LOGIN_MAX_FAILURES - 1);
    recordAuthEvent(db, { event: 'login_ok', email: 'a@x.co', ip: '1.2.3.4' });
    expect(recentFailures(db, 'a@x.co', '1.2.3.4')).toBe(0);
  });
});

describe('password policy', () => {
  test('accepts a decent password', () => {
    expect(passwordProblem('Str0ng-pass-2026')).toBeNull();
  });

  test('rejects one that is too short', () => {
    expect(passwordProblem('Ab3!x')).toMatch(new RegExp(`${MIN_PASSWORD_LENGTH}`));
  });

  test('rejects a long string of one thing — length alone is not strength', () => {
    expect(passwordProblem('aaaaaaaaaaaaaaaa')).toBeTruthy();
    expect(passwordProblem('1234567890123456')).toBeTruthy();
  });

  test('rejects the passwords everyone tries first', () => {
    expect(passwordProblem('password123456')).toMatch(/too common/i);
    expect(passwordProblem('qwerty1234567890')).toMatch(/too common/i);
  });

  test('a passphrase passes without needing punctuation gymnastics', () => {
    // Length carries real entropy; forcing symbols mostly produces "P@ssw0rd!".
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });
});

/**
 * Regression: the reset endpoint once recorded its requests as 'login_failed',
 * which meant asking to reset your own password moved you toward a lockout —
 * the counter punishing the exact recovery path it should leave open.
 */
describe('a reset request is not a failed login', () => {
  test('asking for a reset link never counts toward the lockout', () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES + 2; i++) {
      recordAuthEvent(db, { event: 'reset_requested', email: 'a@x.co', ip: '1.2.3.4' });
    }
    expect(recentFailures(db, 'a@x.co', '1.2.3.4')).toBe(0);
    expect(loginBlocked(db, 'a@x.co', '1.2.3.4')).toBe(false);
  });
});

import { describe, expect, test, beforeEach, afterAll, vi } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { createUser, authenticate } from '@/lib/auth';
import {
  googleConfigured,
  buildAuthUrl,
  signState,
  verifyState,
  linkOrCreateGoogleUser,
  GOOGLE_STATE_COOKIE,
} from '@/lib/google-oauth';

const prevId = process.env.GOOGLE_CLIENT_ID;
const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
afterAll(() => {
  if (prevId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = prevId;
  if (prevSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = prevSecret;
});

let db: FounderDb;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('configuration', () => {
  test('reports configured only when both halves are present', () => {
    expect(googleConfigured()).toBe(true);
    const saved = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleConfigured()).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = saved;
  });
});

describe('the authorization URL', () => {
  test('goes to Google, asks only for identity, and carries the state', () => {
    const url = new URL(buildAuthUrl('http://localhost:4100/api/auth/google/callback', 'the-state'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('the-state');
    // Identity only. Asking for more would mean holding tokens we never use.
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
});

/**
 * `state` is the CSRF defence: without it an attacker can hand a victim a
 * callback URL carrying the attacker's code and log them into the wrong
 * account. Signing it means the callback can trust a value it did not store.
 */
describe('state', () => {
  test('round-trips a value it signed', () => {
    const state = signState('/agents');
    expect(verifyState(state)).toBe('/agents');
  });

  test('rejects an unsigned or tampered value', () => {
    expect(verifyState('just-made-this-up')).toBeNull();
    const good = signState('/agents');
    expect(verifyState(good.slice(0, -3) + 'xxx')).toBeNull();
    expect(verifyState('')).toBeNull();
  });

  test('the cookie name is stable', () => {
    expect(GOOGLE_STATE_COOKIE).toBe('emind_oauth_state');
  });
});

describe('linking a Google identity to an account', () => {
  const profile = (over: Partial<Record<string, unknown>> = {}) => ({
    sub: 'google-sub-123',
    email: 'person@example.com',
    email_verified: true,
    name: 'A Person',
    ...over,
  }) as Parameters<typeof linkOrCreateGoogleUser>[1];

  test('creates an account on first sign-in', () => {
    const user = linkOrCreateGoogleUser(db, profile());
    expect(user.email).toBe('person@example.com');
    expect(user.name).toBe('A Person');
    expect(db.users.count()).toBe(1);
  });

  test('signing in twice reuses the same account', () => {
    const first = linkOrCreateGoogleUser(db, profile());
    const second = linkOrCreateGoogleUser(db, profile());
    expect(second.id).toBe(first.id);
    expect(db.users.count()).toBe(1);
  });

  test('an existing password account with the same email is LINKED, not duplicated', () => {
    const existing = createUser(db, { email: 'person@example.com', name: 'A Person', password: 'pw-12345678' });
    const viaGoogle = linkOrCreateGoogleUser(db, profile());

    expect(viaGoogle.id).toBe(existing.id);
    expect(db.users.count()).toBe(1);
    // Both doors still open: linking must not disable the password.
    expect(authenticate(db, 'person@example.com', 'pw-12345678')).toBeTruthy();
  });

  test('an UNVERIFIED Google email is refused — it would be an account takeover', () => {
    createUser(db, { email: 'victim@example.com', name: 'Victim', password: 'pw-12345678' });
    expect(() =>
      linkOrCreateGoogleUser(db, profile({ email: 'victim@example.com', email_verified: false })),
    ).toThrow(/verified/i);
    expect(db.users.count()).toBe(1);
  });

  test('email case never splits an account', () => {
    const first = linkOrCreateGoogleUser(db, profile());
    const again = linkOrCreateGoogleUser(db, profile({ email: 'Person@EXAMPLE.com', sub: 'google-sub-123' }));
    expect(again.id).toBe(first.id);
  });

  test('a changed Google email follows the subject id, not the address', () => {
    const first = linkOrCreateGoogleUser(db, profile());
    const renamed = linkOrCreateGoogleUser(db, profile({ email: 'new-address@example.com' }));
    expect(renamed.id).toBe(first.id);
    expect(db.users.count()).toBe(1);
  });

  test('a missing email is refused rather than creating a nameless account', () => {
    expect(() => linkOrCreateGoogleUser(db, profile({ email: undefined }))).toThrow();
  });
});

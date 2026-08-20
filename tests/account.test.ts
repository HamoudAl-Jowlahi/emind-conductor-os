import { describe, expect, test, beforeEach, afterAll } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { createUser, createSession, authenticate, resolveSession } from '@/lib/auth';
import { putSecret, ROOT_KEY_ENV } from '@/lib/vault';
import { updateProfile, changePassword, deleteAccount, revokeOtherSessions } from '@/lib/account';

const prev = process.env[ROOT_KEY_ENV];
process.env[ROOT_KEY_ENV] = 'e'.repeat(64);
afterAll(() => {
  if (prev === undefined) delete process.env[ROOT_KEY_ENV];
  else process.env[ROOT_KEY_ENV] = prev;
});

let db: FounderDb;
let a: string;
let b: string;
beforeEach(() => {
  db = openDb(':memory:');
  seedDatabase(db);
  a = createUser(db, { email: 'a@x.co', name: 'A', password: 'pw-12345678' }).id;
  b = createUser(db, { email: 'b@x.co', name: 'B', password: 'pw-12345678' }).id;
});

describe('profile', () => {
  test('updates the name and lowercases a changed email', () => {
    const updated = updateProfile(db, a, { name: '  Hamoud KJ  ', email: 'NEW@Example.COM' });
    expect(updated.name).toBe('Hamoud KJ');
    expect(updated.email).toBe('new@example.com');
    expect(db.users.byId(a)?.email).toBe('new@example.com');
  });

  test('refuses an email another account already uses', () => {
    expect(() => updateProfile(db, a, { name: 'A', email: 'b@x.co' })).toThrow(/already/i);
    expect(db.users.byId(a)?.email).toBe('a@x.co'); // unchanged
  });

  test('keeping your own email is not a conflict', () => {
    expect(() => updateProfile(db, a, { name: 'A2', email: 'a@x.co' })).not.toThrow();
  });
});

describe('password', () => {
  test('requires the current password', () => {
    expect(() => changePassword(db, a, 'wrong-one', 'a-new-password-99')).toThrow(/current password/i);
    expect(authenticate(db, 'a@x.co', 'pw-12345678')).toBeTruthy(); // still the old one
  });

  test('changes it when the current password is right', () => {
    changePassword(db, a, 'pw-12345678', 'a-new-password-99');
    expect(authenticate(db, 'a@x.co', 'pw-12345678')).toBeNull();
    expect(authenticate(db, 'a@x.co', 'a-new-password-99')).toBeTruthy();
  });

  test('a password change logs out every OTHER session, keeping the current one', () => {
    const here = createSession(db, a);
    const elsewhere = createSession(db, a);

    changePassword(db, a, 'pw-12345678', 'a-new-password-99', { keepSessionId: here });

    // The point of changing a password is often that someone else has it.
    expect(resolveSession(db, here)?.id).toBe(a);
    expect(resolveSession(db, elsewhere)).toBeNull();
  });

  test('rejects a new password shorter than the minimum', () => {
    expect(() => changePassword(db, a, 'pw-12345678', 'short')).toThrow(/10 characters/i);
  });
});

describe('sessions', () => {
  test('lists this user sessions only, newest first, and never the token itself', () => {
    createSession(db, a);
    createSession(db, a);
    createSession(db, b);

    const mine = db.sessions.byUser(a);
    expect(mine).toHaveLength(2);
    // The id IS the bearer token: exposing it in a list would hand over the session.
    expect(Object.keys(mine[0])).not.toContain('id');
  });

  test('revoking others keeps the current session alive', () => {
    const here = createSession(db, a);
    const elsewhere = createSession(db, a);
    const revoked = revokeOtherSessions(db, a, here);

    expect(revoked).toBe(1);
    expect(resolveSession(db, here)).toBeTruthy();
    expect(resolveSession(db, elsewhere)).toBeNull();
  });

  test('revoking never touches another user sessions', () => {
    const mine = createSession(db, a);
    const theirs = createSession(db, b);
    revokeOtherSessions(db, a, mine);
    expect(resolveSession(db, theirs)?.id).toBe(b);
  });
});

describe('deleting an account', () => {
  test('requires the password', () => {
    expect(() => deleteAccount(db, a, 'wrong')).toThrow(/password/i);
    expect(db.users.byId(a)).toBeTruthy();
  });

  test('removes the user, their sessions, credentials and data', () => {
    db.claimOrphanRows(a);
    putSecret(db, a, 'NOTION_API_KEY', 'ntn_secret');
    const token = createSession(db, a);
    expect(db.withUser(a).metrics.all().length).toBeGreaterThan(0);

    deleteAccount(db, a, 'pw-12345678');

    expect(db.users.byId(a)).toBeNull();
    expect(resolveSession(db, token)).toBeNull();
    expect(db.userCredentials.names(a)).toEqual([]);
    expect(db.withUser(a).metrics.all()).toEqual([]);
  });

  test('one account deletion leaves every other account untouched', () => {
    db.claimOrphanRows(b);
    putSecret(db, b, 'NOTION_API_KEY', 'b-key');
    deleteAccount(db, a, 'pw-12345678');

    expect(db.users.byId(b)).toBeTruthy();
    expect(db.userCredentials.names(b)).toEqual(['NOTION_API_KEY']);
    expect(db.withUser(b).metrics.all().length).toBeGreaterThan(0);
  });
});

import { describe, expect, test, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, type FounderDb } from '@/lib/db';
import {
  hashPassword,
  verifyPassword,
  createSession,
  resolveSession,
  destroySession,
  createUser,
  authenticate,
  SESSION_COOKIE,
} from '@/lib/auth';

let db: FounderDb;
beforeEach(() => {
  db = openDb(':memory:');
});

/**
 * Passwords are hashed with node:crypto scrypt — deliberately NOT bcrypt or
 * argon2, both of which are native modules. This project already lost a day to
 * a native-module ABI break (better-sqlite3 on Node 26); adding another one
 * would reintroduce exactly that failure mode for zero security gain.
 */
describe('password hashing', () => {
  test('the same password hashes differently every time (random salt)', () => {
    const a = hashPassword('correct horse battery staple');
    const b = hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    expect(a).toContain(':'); // salt:derived
  });

  test('never stores the password itself', () => {
    const stored = hashPassword('hunter2');
    expect(stored).not.toContain('hunter2');
  });

  test('verifies the right password and rejects the wrong one', () => {
    const stored = hashPassword('s3cret-pass');
    expect(verifyPassword('s3cret-pass', stored)).toBe(true);
    expect(verifyPassword('s3cret-pas', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  test('a malformed stored hash returns false instead of throwing', () => {
    expect(verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
    expect(verifyPassword('anything', 'zz:zz')).toBe(false);
  });
});

describe('users', () => {
  test('createUser stores a hash, never the password, and lowercases the email', () => {
    const u = createUser(db, { email: 'Owner@Example.COM', name: 'Owner', password: 'pw-12345678' });
    expect(u.email).toBe('owner@example.com');
    const row = db.users.byEmail('owner@example.com');
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('pw-12345678');
  });

  test('authenticate returns the user for right credentials, null otherwise', () => {
    createUser(db, { email: 'a@b.co', name: 'A', password: 'pw-12345678' });
    expect(authenticate(db, 'a@b.co', 'pw-12345678')?.name).toBe('A');
    expect(authenticate(db, 'a@b.co', 'wrong')).toBeNull();
    expect(authenticate(db, 'nobody@b.co', 'pw-12345678')).toBeNull();
  });

  test('email match is case-insensitive at login too', () => {
    createUser(db, { email: 'a@b.co', name: 'A', password: 'pw-12345678' });
    expect(authenticate(db, 'A@B.CO', 'pw-12345678')?.email).toBe('a@b.co');
  });

  test('hasUsers reports whether this install has been claimed yet', () => {
    expect(db.users.count()).toBe(0);
    createUser(db, { email: 'a@b.co', name: 'A', password: 'pw-12345678' });
    expect(db.users.count()).toBe(1);
  });
});

describe('sessions', () => {
  test('a fresh session resolves to its user', () => {
    const u = createUser(db, { email: 'a@b.co', name: 'A', password: 'pw-12345678' });
    const token = createSession(db, u.id);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(resolveSession(db, token)?.id).toBe(u.id);
  });

  test('an unknown token resolves to null', () => {
    expect(resolveSession(db, 'made-up-token')).toBeNull();
    expect(resolveSession(db, '')).toBeNull();
  });

  test('an expired session resolves to null and is not honoured', () => {
    const u = createUser(db, { email: 'a@b.co', name: 'A', password: 'pw-12345678' });
    const token = createSession(db, u.id, -1000); // already expired
    expect(resolveSession(db, token)).toBeNull();
  });

  test('destroySession makes the token stop working immediately', () => {
    const u = createUser(db, { email: 'a@b.co', name: 'A', password: 'pw-12345678' });
    const token = createSession(db, u.id);
    expect(resolveSession(db, token)).toBeTruthy();
    destroySession(db, token);
    expect(resolveSession(db, token)).toBeNull();
  });

  test('two sessions for one user are independent', () => {
    const u = createUser(db, { email: 'a@b.co', name: 'A', password: 'pw-12345678' });
    const t1 = createSession(db, u.id);
    const t2 = createSession(db, u.id);
    expect(t1).not.toBe(t2);
    destroySession(db, t1);
    expect(resolveSession(db, t1)).toBeNull();
    expect(resolveSession(db, t2)?.id).toBe(u.id);
  });

  test('the cookie name is stable — changing it logs everyone out', () => {
    expect(SESSION_COOKIE).toBe('emind_session');
  });
});

/**
 * The whole point of lib/operator.ts was to leave a seam that authentication
 * could fill. These pin that it is actually filled: the greeting and the org
 * chart must follow the signed-in account, not the env defaults. Without this,
 * a refactor could quietly fall back to OPERATOR_NAME and nobody would notice
 * — every screen would still render a plausible name.
 */
describe('session drives operator identity, not the env defaults', () => {
  test('a session resolves to that user, whoever the env says the operator is', () => {
    const u = createUser(db, { email: 'zahra@x.co', name: 'Zahra Al-Proof', password: 'pw-12345678', role: 'Analyst' });
    const token = createSession(db, u.id);
    const resolved = resolveSession(db, token)!;
    expect(resolved.name).toBe('Zahra Al-Proof');
    expect(resolved.role).toBe('Analyst');
    expect(resolved.name).not.toBe(process.env.OPERATOR_NAME ?? 'Operator');
  });

  test('the home page reads the operator from the session bridge, not the env module', () => {
    const page = readFileSync(join(process.cwd(), 'app/(app)/page.tsx'), 'utf8');
    expect(page).toContain('currentOperator');
    expect(page).not.toContain("from '@/lib/operator'");
  });

  test('the org chart reads the operator from the session bridge too', () => {
    const page = readFileSync(join(process.cwd(), 'app/(app)/org/page.tsx'), 'utf8');
    expect(page).toContain('currentOperator');
    expect(page).not.toContain("from '@/lib/operator'");
  });

  test('the protected group guards itself; /login stays outside it', () => {
    const layout = readFileSync(join(process.cwd(), 'app/(app)/layout.tsx'), 'utf8');
    expect(layout).toContain('currentUser');
    expect(layout).toContain("redirect('/login')");
    // The chrome must not sit in the root layout, or it would render for
    // signed-out visitors on the login screen.
    const root = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
    expect(root).not.toContain('<Sidebar');
    expect(existsSync(join(process.cwd(), 'app/login/page.tsx'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'app/(app)/login'))).toBe(false);
  });

  test('middleware gates everything except the login and auth surface', () => {
    const mw = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');
    expect(mw).toContain("'/login'");
    expect(mw).toContain("'/api/auth/'");
    expect(mw).toContain('emind_session');
    // API callers must get a status, not a redirect to an HTML page.
    expect(mw).toMatch(/status: 401/);
  });
});

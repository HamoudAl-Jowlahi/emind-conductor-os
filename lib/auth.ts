/**
 * Authentication core — password hashing, users, and sessions.
 *
 * Deliberately dependency-free. Two reasons:
 *
 *  1. bcrypt and argon2 are NATIVE modules. This project already lost time to
 *     a native-module ABI break (better-sqlite3 had no prebuilt binary on
 *     Node 26), and adding another one reintroduces that exact failure for no
 *     security gain — node:crypto's scrypt is a memory-hard KDF and is what
 *     the platform ships for this job.
 *  2. A full auth framework would drag session adapters, OAuth plumbing, and
 *     its own config surface into a single-operator local app. This layer is
 *     ~120 lines, fully tested, and swappable behind `resolveOperator()`.
 *
 * The session token IS the secret: 256 bits of CSPRNG randomness, stored and
 * looked up server-side, so the cookie needs no separate signature. Revocation
 * is a row delete, which a signed stateless cookie could not offer.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FounderDb } from '@/lib/db';
import type { User } from '@/lib/schemas';

/** Renaming this invalidates every live session. */
export const SESSION_COOKIE = 'emind_session';

/** 30 days, in milliseconds. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** `salt:derived`, both hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Constant-time comparison. Any malformed stored value is a `false`, never a
 * throw — a corrupt row must fail the login, not crash the login route.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(':');
  if (!salt || !derivedHex) return false;
  try {
    const expected = Buffer.from(derivedHex, 'hex');
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Emails are stored and compared lowercased so case can never split an account. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createUser(
  db: FounderDb,
  input: { email: string; name: string; password: string; role?: string },
): User {
  const user: User = {
    id: randomUUID(),
    email: normalizeEmail(input.email),
    name: input.name.trim(),
    role: input.role?.trim() || 'Founder',
    createdAt: new Date().toISOString(),
  };
  db.users.insert(user, hashPassword(input.password));
  return user;
}

/** The user for these credentials, or null. Never says which half was wrong. */
export function authenticate(db: FounderDb, email: string, password: string): User | null {
  const row = db.users.byEmail(normalizeEmail(email));
  if (!row) return null;
  return verifyPassword(password, row.passwordHash) ? row.user : null;
}

/** Returns the opaque session token to put in the cookie. */
export function createSession(db: FounderDb, userId: string, ttlMs: number = SESSION_TTL_MS): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.sessions.insert({
    id: token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  });
  return token;
}

/** The signed-in user for a token, or null if unknown or expired. */
export function resolveSession(db: FounderDb, token: string): User | null {
  if (!token) return null;
  const row = db.sessions.byId(token);
  if (!row) return null;
  if (new Date(row.session.expiresAt).getTime() <= Date.now()) {
    // Expired tokens are swept on sight rather than left to accumulate.
    db.sessions.remove(token);
    return null;
  }
  return row.user;
}

export function destroySession(db: FounderDb, token: string): void {
  db.sessions.remove(token);
}

/**
 * Account operations — the work behind /settings.
 *
 * Kept apart from lib/auth.ts, which owns the primitives (hashing, sessions).
 * This file owns the POLICY: what a password change does to other sessions,
 * what deleting an account takes with it, when an email is a conflict.
 */
import { hashPassword, verifyPassword, normalizeEmail } from '@/lib/auth';
import type { FounderDb } from '@/lib/db';
import type { User } from '@/lib/schemas';

/** Matches the minimum enforced at signup. */
export const MIN_PASSWORD_LENGTH = 10;

export function updateProfile(
  db: FounderDb,
  userId: string,
  input: { name: string; email: string },
): User {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) throw new Error('Name cannot be empty.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email address is not valid.');

  // Someone else holding this address is a conflict; holding it yourself is not.
  const existing = db.users.byEmail(email);
  if (existing && existing.user.id !== userId) {
    throw new Error('That email is already in use by another account.');
  }

  // Moving to a new address un-verifies it. Otherwise verification is trivial
  // to bypass: prove one address you own, then quietly switch to any other.
  const movedAddress = db.users.byId(userId)?.email !== email;

  db.users.updateProfile(userId, name, email);
  if (movedAddress) db.users.setEmailVerified(userId, false);

  const updated = db.users.byId(userId);
  if (!updated) throw new Error('Account not found.');
  return updated;
}

/**
 * Change a password, and sign every other device out.
 *
 * The usual reason to change a password is that someone else may have it, so
 * leaving their session alive would defeat the point. The caller passes the
 * session to keep so the person doing it is not logged out of their own tab.
 */
export function changePassword(
  db: FounderDb,
  userId: string,
  currentPassword: string,
  newPassword: string,
  opts: { keepSessionId?: string } = {},
): void {
  const user = db.users.byId(userId);
  if (!user) throw new Error('Account not found.');

  const stored = db.users.byEmail(user.email);
  if (!stored || !verifyPassword(currentPassword, stored.passwordHash)) {
    throw new Error('That is not your current password.');
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  db.users.updatePasswordHash(userId, hashPassword(newPassword));
  if (opts.keepSessionId) db.sessions.removeOthers(userId, opts.keepSessionId);
  else db.sessions.removeAllForUser(userId);
}

/** Sign out everywhere except here. Returns how many sessions ended. */
export function revokeOtherSessions(db: FounderDb, userId: string, keepSessionId: string): number {
  return db.sessions.removeOthers(userId, keepSessionId);
}

/**
 * Delete an account and everything it owns.
 *
 * Password-gated: this is irreversible, and a hijacked session should not be
 * able to erase someone's business on its own.
 */
export function deleteAccount(db: FounderDb, userId: string, password: string): void {
  const user = db.users.byId(userId);
  if (!user) throw new Error('Account not found.');

  const stored = db.users.byEmail(user.email);
  if (!stored || !verifyPassword(password, stored.passwordHash)) {
    throw new Error('That is not your password.');
  }

  db.purgeUserData(userId);
  db.users.remove(userId);
}

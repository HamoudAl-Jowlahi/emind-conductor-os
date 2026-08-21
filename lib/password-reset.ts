/**
 * Password reset by emailed link.
 *
 * Three decisions shape this file:
 *
 *  - The token is stored HASHED. A reset token is a temporary password, so a
 *    leaked database should not hand over live ones. SHA-256 rather than
 *    scrypt: these are 256 bits of CSPRNG randomness, where slow hashing only
 *    taxes the server without making brute force any less impossible.
 *  - Issuing returns null for an unknown address, and the ROUTE still answers
 *    "sent". A different response per address turns the reset form into a way
 *    to enumerate which emails have accounts here.
 *  - Spending one ends every session. The usual reason someone resets is that
 *    they lost control of the account, so leaving the intruder signed in would
 *    defeat the exercise.
 */
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from '@/lib/auth';
import { passwordProblem } from '@/lib/auth-guard';
import type { FounderDb } from '@/lib/db';

/** Long enough to act on, short enough that a forwarded email goes stale. */
export const RESET_TTL_MS = 60 * 60 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Mint a reset token for this address, or null when nobody holds it.
 * Any previous token for the account is invalidated — two live reset links is
 * one more than anybody needs.
 */
export function issueResetToken(db: FounderDb, email: string): string | null {
  const found = db.users.byEmail(email.trim().toLowerCase());
  if (!found) return null;

  const token = randomBytes(32).toString('base64url');
  db.passwordResets.put({
    userId: found.user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(),
  });
  return token;
}

/**
 * Spend a token and set the new password. Returns false when the token is
 * unknown, already used, or expired — the three cases the caller reports
 * identically, because distinguishing them tells an attacker where to look.
 *
 * Throws (rather than returning false) when the PASSWORD is the problem, so
 * the token survives for another try: burning it on a typo strands the user
 * with no way back in.
 */
export function consumeResetToken(db: FounderDb, token: string, newPassword: string): boolean {
  if (!token) return false;

  const row = db.passwordResets.get(hashToken(token));
  if (!row) return false;
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    db.passwordResets.remove(row.tokenHash);
    return false;
  }

  const weak = passwordProblem(newPassword);
  if (weak) throw new Error(weak);

  db.users.updatePasswordHash(row.userId, hashPassword(newPassword));
  db.passwordResets.remove(row.tokenHash);
  db.sessions.removeAllForUser(row.userId);
  return true;
}

/** The link a user clicks. Same-origin by construction. */
export function resetUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/reset?token=${encodeURIComponent(token)}`;
}

/** Housekeeping — expired rows are litter, not evidence. */
export function purgeExpiredResets(db: FounderDb): number {
  return db.passwordResets.purgeExpired(new Date().toISOString());
}

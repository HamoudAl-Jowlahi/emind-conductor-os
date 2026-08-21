/**
 * Email verification — proving the address on an account belongs to whoever
 * registered it.
 *
 * Without this, "sign up" means "type any address". Someone can register with
 * a colleague's address, an address nobody owns, or a hundred throwaways, and
 * be indistinguishable from a real user. It also makes password reset
 * meaningless: a reset link sent to an unproven address proves nothing.
 *
 * Tokens follow the same rules as reset tokens — hashed at rest, single use,
 * time-limited, one live token per account — for the same reason: a
 * verification link is a temporary credential.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FounderDb } from '@/lib/db';

/** A day: long enough for someone to check mail tomorrow, short enough to expire. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function isEmailVerified(db: FounderDb, userId: string): boolean {
  return db.users.isEmailVerified(userId);
}

export function markEmailVerified(db: FounderDb, userId: string): void {
  db.users.setEmailVerified(userId, true);
}

/** Mint a link token, replacing any previous one for this account. */
export function issueVerificationToken(db: FounderDb, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  db.emailVerifications.put({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS).toISOString(),
  });
  return token;
}

/**
 * Spend a token and verify its account. Returns the user id, or null when the
 * token is unknown, already used, or expired — three cases the caller reports
 * identically, since telling them apart only helps someone probing.
 */
export function consumeVerificationToken(db: FounderDb, token: string): string | null {
  if (!token) return null;

  const row = db.emailVerifications.get(hashToken(token));
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    db.emailVerifications.remove(row.tokenHash);
    return null;
  }

  markEmailVerified(db, row.userId);
  db.emailVerifications.remove(row.tokenHash);
  return row.userId;
}

/** The link that lands in the inbox. Same-origin by construction. */
export function verificationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/verify?token=${encodeURIComponent(token)}`;
}

/**
 * Send the verification email.
 *
 * Returns the delivery outcome rather than throwing, and — when SMTP is not
 * configured — logs the link to the server console. On a self-hosted install
 * with no mail set up, silently failing here would lock the operator out of
 * their own system with no way back in.
 */
export async function sendVerificationEmail(
  to: string,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const { sendEmailReply } = await import('@/lib/connectors/email');
  const sent = await sendEmailReply({
    to,
    subject: 'Confirm your eMind Conductor OS email',
    text: [
      'Confirm this address to finish setting up your account:',
      '',
      url,
      '',
      'The link works once and expires in 24 hours. If you did not sign up,',
      'ignore this message — the account cannot be used without it.',
    ].join('\n'),
  });

  if (!sent.ok) {
    console.error('[verify] could not send to %s: %s', to, sent.error);
    console.error('[verify] link (SMTP is not configured): %s', url);
  }
  return sent;
}

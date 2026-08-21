/**
 * Login hardening: the audit trail, rate limiting, and the password policy.
 *
 * The three belong together because the audit trail IS the rate limiter's
 * memory. Counting recent failures in the database rather than in a process
 * map means a restart does not hand an attacker a fresh budget, and a second
 * server instance shares the same view instead of each granting its own quota.
 * It also leaves the "was that me?" record the owner dashboard will read.
 */
import type { FounderDb } from '@/lib/db';

/* ── Rate limiting ────────────────────────────────────────────────────────
 * Tuned to stop a script, not a person: five wrong tries is already unusual
 * for someone who knows their password, and fifteen minutes is long enough to
 * make guessing pointless while short enough that a locked-out user does not
 * need support.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Distinct accounts one address may fail against before it is the spray. */
export const SPRAY_MAX_ACCOUNTS = 5;

export type AuthEventKind =
  | 'login_ok'
  | 'login_failed'
  | 'login_blocked'
  | 'signup'
  | 'password_changed'
  | 'google_login'
  /** A reset link was asked for. Deliberately NOT counted as a failure — see
   *  failuresSince, which only sums 'login_failed'. Asking to reset your own
   *  password must never move you closer to being locked out. */
  | 'reset_requested';

export type AuthEventInput = {
  event: AuthEventKind;
  email?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
};

/** Record an attempt. Never called with a password, and never logs one. */
export function recordAuthEvent(db: FounderDb, input: AuthEventInput): void {
  db.authEvents.insert({
    event: input.event,
    email: input.email ? input.email.trim().toLowerCase() : null,
    userId: input.userId ?? null,
    ip: input.ip ?? null,
    // Long enough to identify a browser, short enough not to become storage.
    userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
    at: new Date().toISOString(),
  });
}

/** Failures for this exact (email, address) pair since its last success. */
export function recentFailures(db: FounderDb, email: string, ip: string): number {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  return db.authEvents.failuresSince(email.trim().toLowerCase(), ip, since);
}

/**
 * Two independent brakes, because one attack does not look like the other:
 *
 *  - Grinding: many wrong passwords at ONE account from one place. Caught by
 *    the pair counter.
 *  - Spraying: one common password against MANY accounts from one place. Each
 *    account sees a single failure, so no per-account counter would ever fire;
 *    the distinct-email count is what sees it.
 *
 * Both key on the address as well as the account, so an attacker locks out
 * themselves rather than the victim.
 */
export function loginBlocked(db: FounderDb, email: string, ip: string): boolean {
  if (recentFailures(db, email, ip) >= LOGIN_MAX_FAILURES) return true;
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  return db.authEvents.distinctEmailsFailedFrom(ip, since) >= SPRAY_MAX_ACCOUNTS;
}

/* ── Password policy ──────────────────────────────────────────────────────
 * Length first. A long passphrase carries far more entropy than a short
 * string tortured into meeting symbol rules, and symbol rules mostly produce
 * "P@ssw0rd!" — a password that satisfies every checkbox and appears in every
 * cracking dictionary. So: a real minimum, a rejection of single-character and
 * sequential filler, and a short list of what people actually try first.
 */
export const MIN_PASSWORD_LENGTH = 10;

const COMMON = [
  'password', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou',
  'monkey', 'dragon', 'football', 'abc123', 'sunshine', 'princess',
];

/** A human-readable problem, or null when the password is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  const lower = password.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) {
    return 'That password is too common — pick something less guessable.';
  }

  // "aaaaaaaaaaa" clears any length rule while carrying almost no entropy.
  if (new Set(password).size < 5) {
    return 'That password repeats too few different characters.';
  }

  // Runs like 1234567890 or abcdefghij are the other way length lies.
  if (isSequential(lower)) {
    return 'That password is a simple sequence — pick something less predictable.';
  }

  return null;
}

function isSequential(value: string): boolean {
  let ascending = 0;
  for (let i = 1; i < value.length; i++) {
    if (value.charCodeAt(i) === value.charCodeAt(i - 1) + 1) ascending++;
    else ascending = 0;
    if (ascending >= 5) return true; // six characters in a row is not a choice
  }
  return false;
}

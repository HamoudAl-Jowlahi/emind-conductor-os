/**
 * Sign in with Google — identity only.
 *
 * We ask for `openid email profile` and nothing else, because all this flow
 * needs is "who is this person". That single decision removes the sharp edges
 * of OAuth: no refresh tokens, nothing to store, nothing to expire, no PKCE.
 * What is left is an authorization-code exchange and a signed `state`, which
 * is why this is ~150 lines and no new dependency instead of an auth
 * framework that would want to own the session layer we already have.
 *
 * The callback ends by calling `createSession` — the same session every
 * password login gets. Google verifies the identity; the rest is unchanged.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { normalizeEmail, hashPassword } from '@/lib/auth';
import type { FounderDb } from '@/lib/db';
import type { User } from '@/lib/schemas';

export const GOOGLE_STATE_COOKIE = 'emind_oauth_state';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Identity only — see the header note on why nothing else is requested. */
const SCOPES = 'openid email profile';

export type GoogleProfile = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The secret that signs `state`. Reuses the vault root key when present so
 * there is one fewer secret to manage; falls back to a per-process random so
 * development works without configuration — at the cost of invalidating any
 * in-flight login on restart, which is harmless for a 5-minute redirect.
 */
let ephemeralSecret: string | null = null;
function stateSecret(): string {
  const configured = process.env.CREDENTIALS_KEY ?? process.env.GOOGLE_CLIENT_SECRET;
  if (configured) return configured;
  if (!ephemeralSecret) ephemeralSecret = randomBytes(32).toString('hex');
  return ephemeralSecret;
}

/**
 * `payload.signature`. The payload is where the user should land afterwards,
 * plus a nonce so two logins never produce the same state.
 */
export function signState(returnTo: string): string {
  const payload = Buffer.from(JSON.stringify({ returnTo, n: randomUUID() })).toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** The `returnTo` this state was signed with, or null if it was not ours. */
export function verifyState(state: string): string | null {
  const [payload, sig] = (state ?? '').split('.');
  if (!payload || !sig) return null;

  const expected = createHmac('sha256', stateSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    // Only same-site paths: an open redirect here would let an attacker bounce
    // a freshly authenticated visitor to a site of their choosing.
    return typeof parsed.returnTo === 'string' && parsed.returnTo.startsWith('/') ? parsed.returnTo : '/';
  } catch {
    return null;
  }
}

/**
 * The callback URL for this request. Derived from the incoming request rather
 * than hard-coded so dev and production each produce their own — but Google
 * compares it CHARACTER FOR CHARACTER against the console's list, so
 * PUBLIC_ORIGIN exists for deployments behind a proxy that rewrites the host.
 */
export function callbackUrlFor(req: Request): string {
  const origin = process.env.PUBLIC_ORIGIN ?? new URL(req.url).origin;
  return `${origin.replace(/\/$/, '')}/api/auth/google/callback`;
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  // Always show the chooser: on a shared machine, silently reusing the last
  // Google session is how someone ends up signed in as a colleague.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Trade the one-time code for a token, then read the profile it unlocks. */
export async function fetchGoogleProfile(code: string, redirectUri: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google rejected the sign-in (HTTP ${tokenRes.status}).`);
  }
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error('Google returned no access token.');

  const infoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) throw new Error(`Could not read your Google profile (HTTP ${infoRes.status}).`);
  return (await infoRes.json()) as GoogleProfile;
}

/**
 * Find or create the account behind a Google profile.
 *
 * Matching runs by `sub` first — Google's stable subject id — so someone who
 * changes their Gmail address keeps their account instead of silently starting
 * a new one. Only then does it fall back to matching by email, and ONLY for a
 * verified address: without that check an attacker could register a victim's
 * address with a password first and inherit their Google sign-in.
 */
export function linkOrCreateGoogleUser(db: FounderDb, profile: GoogleProfile): User {
  if (!profile.sub) throw new Error('Google returned no account id.');
  if (!profile.email) throw new Error('Your Google account has no email address.');

  const byId = db.users.byGoogleSub(profile.sub);
  if (byId) return byId;

  const email = normalizeEmail(profile.email);
  const existing = db.users.byEmail(email);

  if (existing) {
    if (!profile.email_verified) {
      throw new Error('Google has not verified that email address, so it cannot be linked to an existing account.');
    }
    db.users.setGoogleSub(existing.user.id, profile.sub);
    db.users.setEmailVerified(existing.user.id, true);
    return existing.user;
  }

  const user: User = {
    id: randomUUID(),
    email,
    name: profile.name?.trim() || email.split('@')[0],
    role: 'Founder',
    createdAt: new Date().toISOString(),
  };
  // A random password: this account signs in through Google, and leaving the
  // hash empty would make an empty password string a valid login.
  db.users.insert(user, hashPassword(randomBytes(32).toString('hex')));
  db.users.setGoogleSub(user.id, profile.sub);
  // Google already proved this address — asking the user to prove it again
  // would be theatre, and email_verified was checked before we got here.
  if (profile.email_verified) db.users.setEmailVerified(user.id, true);
  return user;
}

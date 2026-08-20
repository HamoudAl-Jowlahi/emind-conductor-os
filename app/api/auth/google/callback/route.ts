import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/data';
import { createSession, SESSION_COOKIE } from '@/lib/auth';
import { sessionCookieOptions } from '@/lib/session';
import { backfillRoster } from '@/lib/agents/roster';
import {
  fetchGoogleProfile,
  linkOrCreateGoogleUser,
  verifyState,
  callbackUrlFor,
  GOOGLE_STATE_COOKIE,
} from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fail = (req: Request, reason: string) => {
  const url = new URL('/login', req.url);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
};

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  // The user pressed "cancel" on Google's screen — not an error worth shouting.
  if (params.get('error')) return fail(req, 'Sign-in was cancelled.');

  const code = params.get('code');
  const state = params.get('state') ?? '';
  if (!code) return fail(req, 'Google returned no authorization code.');

  // Both halves must agree: the signature proves we minted it, the cookie
  // proves it was minted for THIS browser. Either alone is not enough.
  const store = await cookies();
  const stashed = store.get(GOOGLE_STATE_COOKIE)?.value;
  if (!stashed || stashed !== state || verifyState(state) === null) {
    return fail(req, 'That sign-in link is not valid. Please try again.');
  }
  const returnTo = verifyState(state) ?? '/';

  let user;
  try {
    const profile = await fetchGoogleProfile(code, callbackUrlFor(req));
    const db = getDb();
    const isFirstUser = db.users.count() === 0;
    user = linkOrCreateGoogleUser(db, profile);

    // Same rule as the password path: the first account IS the install, so it
    // inherits the seeded rows and the full roster. Later accounts start empty.
    if (isFirstUser) {
      db.claimOrphanRows(user.id);
      backfillRoster(db, user.id);
    }
  } catch (err) {
    return fail(req, err instanceof Error ? err.message : 'Google sign-in failed.');
  }

  const token = createSession(getDb(), user.id);
  const res = NextResponse.redirect(new URL(returnTo, req.url));
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  res.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

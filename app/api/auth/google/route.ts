import { NextResponse } from 'next/server';
import { buildAuthUrl, signState, googleConfigured, GOOGLE_STATE_COOKIE } from '@/lib/google-oauth';
import { callbackUrlFor } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Start the flow: mint a signed state, stash it, and hand off to Google. */
export async function GET(req: Request) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: 'Google sign-in is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' },
      { status: 503 },
    );
  }

  const returnTo = new URL(req.url).searchParams.get('returnTo') ?? '/';
  const state = signState(returnTo);

  const res = NextResponse.redirect(buildAuthUrl(callbackUrlFor(req), state));
  // The cookie is the second half of the CSRF check: the callback compares it
  // against the state Google echoes back, so a state minted for someone else's
  // browser is useless in this one.
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // ten minutes is a generous ceiling for a redirect round trip
  });
  return res;
}

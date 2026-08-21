import { NextResponse, type NextRequest } from 'next/server';

/**
 * First-pass gate. This runs before every request and only checks whether a
 * session cookie is PRESENT — it cannot validate one, because middleware has
 * no access to better-sqlite3 (a native module, and this runs off the main
 * server runtime).
 *
 * That is by design, not a shortcut: the cheap check turns away the common
 * case (no cookie at all) without a database round trip, and the authoritative
 * check lives in app/(app)/layout.tsx, which does a real session lookup. A
 * forged cookie gets past here and is rejected there.
 *
 * Public surface, deliberately small:
 *   /login          the sign-in and first-run claim screen
 *   /api/auth/*     the routes that mint a session (they guard themselves)
 *   /icon.svg       the favicon, requested before any session exists
 */
// A locked-out user has no session by definition, so the reset screens must
// sit outside the guard or they would be unreachable by the only people who
// need them.
const PUBLIC = ['/login', '/reset', '/api/auth/', '/icon.svg'];
const SESSION_COOKIE = 'emind_session';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.next();
  }

  // API callers get a status they can act on; humans get the login screen.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own build output and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

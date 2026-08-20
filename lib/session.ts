/**
 * Server-side session access — the bridge between the auth core and the app.
 *
 * Kept apart from lib/auth.ts on purpose: auth.ts is pure logic over a db
 * handle and stays unit-testable with no framework in sight, while this file
 * is the only place that touches next/headers. Anything importing this is a
 * server component or a route handler, never a test of the core.
 */
import { cookies } from 'next/headers';
import { getDb } from '@/lib/data';
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/auth';
import { OPERATOR, type Operator } from '@/lib/operator';
import type { User } from '@/lib/schemas';

/**
 * The signed-in user, or null. Never throws.
 *
 * `cookies()` is only available inside a request, and it throws outside one —
 * which is exactly where seeding scripts and page-render tests live. No
 * request means no session, so the honest answer there is null rather than a
 * crash that would make every page untestable.
 */
export async function currentUser(): Promise<User | null> {
  let token = '';
  try {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value ?? '';
  } catch {
    return null;
  }
  if (!token) return null;
  return resolveSession(getDb(), token);
}

/**
 * The operator identity for the current request.
 *
 * This is the seam lib/operator.ts was written for: with a session it returns
 * the signed-in user, and without one it falls back to the env-configured
 * defaults so seeding, scripts, and tests keep working unchanged.
 */
export async function currentOperator(): Promise<Operator> {
  const user = await currentUser();
  if (!user) return OPERATOR;
  return {
    name: user.name.split(' ')[0] || user.name,
    fullName: user.name,
    role: user.role,
    handle: OPERATOR.handle,
    site: OPERATOR.site,
  };
}

/** True when nobody has claimed this install yet — drives first-run setup. */
export function installNeedsSetup(): boolean {
  return getDb().users.count() === 0;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
} as const;

/* ── Roster helpers ────────────────────────────────────────────────────────
 * Server-side shortcuts so a page never has to resolve the user itself and
 * then remember to scope the query. Ask for the roster; get the right one. */

/** This request's active agents, as rows. Empty when signed out. */
export async function currentRoster() {
  const user = await currentUser();
  if (!user) return [];
  const { rosterFor } = await import('@/lib/agents/roster');
  return rosterFor(getDb(), user.id);
}

/** This request's active agents, executable. Empty when signed out. */
export async function currentRuntimeRoster() {
  const user = await currentUser();
  if (!user) return [];
  const { runtimeRosterFor } = await import('@/lib/agents/roster');
  return runtimeRosterFor(getDb(), user.id);
}

/* ── Scoped database ───────────────────────────────────────────────────────
 * The handle a request should use. Everything below the session layer reads
 * and writes through this, so a page cannot accidentally hold the unscoped
 * handle and serve one user another user's rows. */

/**
 * The database as the signed-in user sees it. Throws when there is no session:
 * a page that reaches for user data without a user is a bug, and failing loudly
 * beats silently handing back the unscoped handle.
 */
export async function currentDb() {
  const user = await currentUser();
  if (!user) throw new Error('currentDb() called without a session');
  const { forUser } = await import('@/lib/db-scoped');
  return forUser(getDb(), user.id);
}

/** The scoped handle, or null when signed out — for callers that can cope. */
export async function currentDbOrNull() {
  const user = await currentUser();
  if (!user) return null;
  const { forUser } = await import('@/lib/db-scoped');
  return forUser(getDb(), user.id);
}

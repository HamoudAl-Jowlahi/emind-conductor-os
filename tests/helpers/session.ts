import { vi } from 'vitest';

/**
 * Sign a test in.
 *
 * Route handlers resolve the caller through `cookies()` from next/headers,
 * which only exists inside a request. Tests call the handlers directly, so the
 * cookie jar has to be faked — this creates a real user and a real session row
 * in the app database, then hands the route the matching cookie.
 *
 * Real rows, not stubs: the route still does a genuine session lookup, so the
 * auth path stays under test instead of being mocked away.
 */
export async function signInTestUser(opts: { email?: string; name?: string; installAll?: boolean } = {}) {
  const { getDb } = await import('@/lib/data');
  const { createUser, createSession, SESSION_COOKIE } = await import('@/lib/auth');
  const { backfillRoster } = await import('@/lib/agents/roster');

  const db = getDb();
  const email = opts.email ?? `test-${Math.random().toString(36).slice(2)}@example.com`;
  const existing = db.users.byEmail(email);
  const user = existing?.user ?? createUser(db, { email, name: opts.name ?? 'Test User', password: 'test-pw-12345678' });

  // Most route tests predate the catalog and expect the whole roster present.
  if (opts.installAll !== false) backfillRoster(db, user.id);

  const token = createSession(db, user.id);

  vi.doMock('next/headers', () => ({
    cookies: async () => ({
      get: (name: string) => (name === SESSION_COOKIE ? { name, value: token } : undefined),
      set: () => {},
      delete: () => {},
    }),
  }));

  return { user, token, db };
}

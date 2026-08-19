import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { createUser, createSession, SESSION_COOKIE } from '@/lib/auth';
import { sessionCookieOptions } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

/**
 * First-run claim. Open only while the install has no users — once one exists
 * this 403s, so it can never become a back door for creating a second account.
 */
export async function POST(req: Request) {
  const db = getDb();
  if (db.users.count() > 0) {
    return NextResponse.json({ error: 'This install already has an operator.' }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues[0]?.message : 'Invalid details.';
    return NextResponse.json({ error: msg ?? 'Invalid details.' }, { status: 400 });
  }

  const user = createUser(db, body);
  const token = createSession(db, user.id);
  const res = NextResponse.json({ user: { name: user.name, email: user.email } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}

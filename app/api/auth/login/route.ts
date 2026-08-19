import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { authenticate, createSession, SESSION_COOKIE } from '@/lib/auth';
import { sessionCookieOptions } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // better-sqlite3 is native — keep off the edge

const Body = z.object({ email: z.string().min(1), password: z.string().min(1) });

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  const db = getDb();
  const user = authenticate(db, body.email, body.password);
  // One message for both failure modes: naming which half was wrong turns the
  // login form into an account-enumeration oracle.
  if (!user) {
    return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
  }

  const token = createSession(db, user.id);
  const res = NextResponse.json({ user: { name: user.name, email: user.email, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/data';
import { destroySession, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  // Delete the row, not just the cookie — a stolen token has to stop working
  // even if the browser never sends the clearing response.
  if (token) destroySession(getDb(), token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

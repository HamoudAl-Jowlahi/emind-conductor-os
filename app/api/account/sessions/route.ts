import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { revokeOtherSessions } from '@/lib/account';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Session metadata only. The id is the bearer token and is never listed. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  return NextResponse.json({ sessions: getDb().sessions.byUser(user.id) });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const here = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  const revoked = revokeOtherSessions(getDb(), user.id, here);
  return NextResponse.json({ ok: true, revoked });
}

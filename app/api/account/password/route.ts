import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { changePassword } from '@/lib/account';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Both passwords are required.' }, { status: 400 });
  }

  // Keep the tab doing the change signed in; every other device is signed out,
  // since the usual reason to change a password is that someone else has it.
  const keepSessionId = (await cookies()).get(SESSION_COOKIE)?.value;

  try {
    changePassword(getDb(), user.id, body.currentPassword, body.newPassword, { keepSessionId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not change it.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

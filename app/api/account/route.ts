import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { updateProfile, deleteAccount } from '@/lib/account';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ProfileBody = z.object({ name: z.string().min(1).max(80), email: z.string().min(3).max(200) });
const DeleteBody = z.object({ password: z.string().min(1) });

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  let body: z.infer<typeof ProfileBody>;
  try {
    body = ProfileBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 });
  }

  try {
    const updated = updateProfile(getDb(), user.id, body);
    return NextResponse.json({ user: { name: updated.name, email: updated.email, role: updated.role } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save.' }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  let body: z.infer<typeof DeleteBody>;
  try {
    body = DeleteBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Your password is required.' }, { status: 400 });
  }

  try {
    deleteAccount(getDb(), user.id, body.password);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not delete.' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

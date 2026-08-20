import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // The caller's own handle — this route cannot read another user's rows.
  const db = getDb().withUser(user.id);
  return NextResponse.json({ metrics: db.metrics.all() });
}

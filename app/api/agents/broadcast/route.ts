import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { createRuntime } from '@/lib/agents/runtime';
import { currentUser } from '@/lib/session';
import { runtimeRosterFor } from '@/lib/agents/roster';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ broadcasts: getDb().broadcasts.recent(10) });
}

export async function POST(req: Request) {
  let message = '';
  try {
    const body = (await req.json()) as { message?: unknown };
    message = typeof body.message === 'string' ? body.message.trim() : '';
  } catch {
    // fall through to the empty-message rejection
  }
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // Broadcast reaches this user's installed agents only. Fanning out to an
  // uninstalled one would have it reach for a connector key the user never
  // supplied — somebody else's, on a shared install.
  const db = getDb().withUser(user.id);
  const runtime = createRuntime(db, runtimeRosterFor(db, user.id));
  const broadcast = await runtime.broadcast(message);
  return NextResponse.json({ broadcast });
}

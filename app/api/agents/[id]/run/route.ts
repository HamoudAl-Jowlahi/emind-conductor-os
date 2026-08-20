import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { createRuntime } from '@/lib/agents/runtime';
import { currentUser } from '@/lib/session';
import { runtimeRosterFor } from '@/lib/agents/roster';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // Built from THIS user's roster: an agent they have not installed is simply
  // not in the registry, so it cannot be run by guessing its id.
  const db = getDb();
  const runtime = createRuntime(db, runtimeRosterFor(db, user.id));
  try {
    const run = await runtime.run(id);
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}

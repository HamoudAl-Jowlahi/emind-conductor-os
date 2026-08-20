import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { installAgent, uninstallAgent, setAgentEnabled, catalogFor } from '@/lib/agents/roster';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  agentId: z.string().min(1),
  action: z.enum(['install', 'uninstall', 'enable', 'disable']),
});

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  return NextResponse.json({ catalog: catalogFor(getDb(), user.id) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'agentId and a valid action are required' }, { status: 400 });
  }

  const db = getDb();
  try {
    // Every branch is scoped to the caller's own id — there is no path here
    // that touches another user's roster.
    if (body.action === 'install') installAgent(db, user.id, body.agentId);
    else if (body.action === 'uninstall') uninstallAgent(db, user.id, body.agentId);
    else setAgentEnabled(db, user.id, body.agentId, body.action === 'enable');
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  return NextResponse.json({ catalog: catalogFor(db, user.id) });
}

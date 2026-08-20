import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { CONTACT_TIERS } from '@/lib/life-map';
import { ContactTagSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // The caller's own handle — this route cannot read another user's rows.
  const db = getDb().withUser(user.id);
  return NextResponse.json({ tiers: CONTACT_TIERS, tags: db.contactTags.all() });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // The caller's own handle — this route cannot read another user's rows.
  const db = getDb().withUser(user.id);
  const parsed = ContactTagSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  db.contactTags.upsert(parsed.data);
  return NextResponse.json({ ok: true, tag: parsed.data });
}

const RemoveSchema = z.object({ person: z.string().min(1), channel: z.string().min(1) });

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // The caller's own handle — this route cannot read another user's rows.
  const db = getDb().withUser(user.id);
  const parsed = RemoveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  db.contactTags.remove(parsed.data.person, parsed.data.channel);
  return NextResponse.json({ ok: true });
}

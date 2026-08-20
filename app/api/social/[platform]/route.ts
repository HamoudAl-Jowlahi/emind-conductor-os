import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { platformDetail, syncFromZernioConfig } from '@/lib/social';
import type { SocialPlatform } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // The caller's own handle — this route cannot read another user's rows.
  const db = getDb().withUser(user.id);
  const { platform } = await params;
  syncFromZernioConfig(db);
  const detail = platformDetail(db, platform as SocialPlatform);
  if (!detail) {
    return NextResponse.json({ error: `unknown platform: ${platform}` }, { status: 404 });
  }
  return NextResponse.json(detail);
}

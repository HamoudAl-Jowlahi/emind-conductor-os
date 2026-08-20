import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { funnelSummary, splitFunnelJourneys } from '@/lib/funnel';
import { attioFunnelJourneys } from '@/lib/funnel-live';
import { ghlFunnelJourneys } from '@/lib/funnel-ghl';
import { mergeTrakyoTouches, trakyoTouches } from '@/lib/funnel-trakyo';
import { FunnelVentureSchema, type FunnelVenture } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // The caller's own handle — this route cannot read another user's rows.
  const db = getDb().withUser(user.id);
  const raw = new URL(req.url).searchParams.get('venture');
  let venture: FunnelVenture | undefined;
  if (raw !== null) {
    const parsed = FunnelVentureSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: `unknown venture: ${raw}` }, { status: 400 });
    }
    venture = parsed.data;
  }
  const now = new Date();
  // Live Attio ∪ GHL when available (Attio venture = deal-name heuristic,
  // GHL is all LC); seeded funnel otherwise. Quiet >90d splits into `archived`.
  const [attioLive, ghlLive] = await Promise.all([attioFunnelJourneys(now), ghlFunnelJourneys(now)]);
  const liveJourneys = [...(attioLive?.journeys ?? []), ...(ghlLive?.journeys ?? [])];
  const isLive = liveJourneys.length > 0;
  const all = isLive
    ? mergeTrakyoTouches(liveJourneys, await trakyoTouches()).filter((j) => !venture || j.venture === venture)
    : db.funnel.journeys(venture);
  const { active, archived } = splitFunnelJourneys(all, now);
  return NextResponse.json({
    summary: funnelSummary(active),
    journeys: active,
    archived,
    source: isLive
      ? [attioLive?.journeys.length ? 'attio' : null, ghlLive?.journeys.length ? 'ghl' : null]
          .filter(Boolean)
          .join('+')
      : 'seed',
    ...(isLive
      ? {
          excluded: (attioLive?.closedLost ?? 0) + (ghlLive?.excluded ?? 0),
          total: (attioLive?.total ?? 0) + (ghlLive?.total ?? 0),
        }
      : {}),
  });
}

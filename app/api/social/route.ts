import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import {
  audienceGrowth,
  audienceTotal,
  buildSocialDashboard,
  dmGrowth,
  monthlyAudienceGrowthPct,
  syncFromZernioConfig,
  totalDms,
} from '@/lib/social';
import { buildEmailList } from '@/lib/email-list';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  // The caller's own handle — this route cannot read another user's rows.
  const db = getDb().withUser(user.id);
  // Every read captures today's follower counts from the Zernio config, so
  // growth history accrues for real just by using the dashboard.
  syncFromZernioConfig(db);
  return NextResponse.json({
    ...buildSocialDashboard(db),
    emailList: buildEmailList(db),
    totalDms: totalDms(db),
    audienceTotal: audienceTotal(db),
    audienceGrowth: audienceGrowth(db), // { d7, d30, d60, allTime }
    dmGrowth: dmGrowth(db), // { d7, d30, d60, allTime }
    monthlyGrowthPct: monthlyAudienceGrowthPct(db), // back-compat
  });
}

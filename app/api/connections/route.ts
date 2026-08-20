import { NextResponse } from 'next/server';
import { allConnectorStatuses } from '@/lib/connectors';
import { withCurrentUserSecrets } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // Resolved inside the caller's credential context: two users on one install
  // see two different boards, each reflecting their own keys.
  const connections = await withCurrentUserSecrets(() => allConnectorStatuses());
  return NextResponse.json({ connections });
}

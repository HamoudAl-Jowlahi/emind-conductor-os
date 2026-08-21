import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import {
  consumeVerificationToken,
  issueVerificationToken,
  sendVerificationEmail,
  verificationUrl,
} from '@/lib/email-verification';
import { loginBlocked } from '@/lib/auth-guard';
import { clientIp } from '@/lib/request-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ConfirmBody = z.object({ token: z.string().min(10) });
const ResendBody = z.object({ email: z.string().min(3).max(200) });

/** Spend a verification link. */
export async function POST(req: Request) {
  let body: z.infer<typeof ConfirmBody>;
  try {
    body = ConfirmBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'That link is missing its token.' }, { status: 400 });
  }

  const userId = consumeVerificationToken(getDb(), body.token);
  if (!userId) {
    return NextResponse.json(
      { error: 'That confirmation link is no longer valid. Ask for a new one.' },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}

/**
 * Send another link.
 *
 * Answers identically whether or not the address has an unverified account —
 * a different reply would let someone discover who is registered here, which
 * is the same reason the reset endpoint stays silent.
 */
export async function PUT(req: Request) {
  let body: z.infer<typeof ResendBody>;
  try {
    body = ResendBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 });
  }

  const db = getDb();
  const ip = clientIp(req);
  if (loginBlocked(db, body.email, ip)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 });
  }

  const found = db.users.byEmail(body.email.trim().toLowerCase());
  if (found && !db.users.isEmailVerified(found.user.id)) {
    const token = issueVerificationToken(db, found.user.id);
    const origin = process.env.PUBLIC_ORIGIN ?? new URL(req.url).origin;
    await sendVerificationEmail(found.user.email, verificationUrl(origin, token));
  }

  return NextResponse.json({
    ok: true,
    message: 'If that address needs confirming, a new link is on its way.',
  });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { issueResetToken, consumeResetToken, resetUrl } from '@/lib/password-reset';
import { sendEmailReply } from '@/lib/connectors/email';
import { recordAuthEvent, loginBlocked } from '@/lib/auth-guard';
import { clientIp, userAgent } from '@/lib/request-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RequestBody = z.object({ email: z.string().min(3).max(200) });
const ConsumeBody = z.object({ token: z.string().min(10), password: z.string().min(1) });

/**
 * Ask for a reset link.
 *
 * Always answers the same way, whether or not the address has an account:
 * a different response per address turns this form into a way to discover who
 * is registered here. The only thing that varies is what happens server-side.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof RequestBody>;
  try {
    body = RequestBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 });
  }

  const db = getDb();
  const ip = clientIp(req);

  // Rate limited on the same counters as login: this endpoint sends mail and
  // does real work, so it is worth a script's while to hammer it.
  if (loginBlocked(db, body.email, ip)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a few minutes.' }, { status: 429 });
  }

  const token = issueResetToken(db, body.email);
  if (token) {
    const origin = process.env.PUBLIC_ORIGIN ?? new URL(req.url).origin;
    const sent = await sendEmailReply({
      to: body.email.trim(),
      subject: 'Reset your eMind Conductor OS password',
      text: [
        'Someone asked to reset the password on your eMind Conductor OS account.',
        '',
        resetUrl(origin, token),
        '',
        'The link works once and expires in an hour. If this was not you, ignore',
        'this message — nothing has changed.',
      ].join('\n'),
    });

    // Honest about delivery in the LOG, silent to the caller. An operator with
    // no SMTP configured needs to see why nothing arrived; a stranger probing
    // the form must not learn whether the address exists.
    if (!sent.ok) console.error('[reset] could not send:', sent.error);

    // Recorded as its own kind, not as a failure: only 'login_failed' feeds the
    // lockout counter, so asking to reset your own password can never be what
    // locks you out of it.
    recordAuthEvent(db, {
      event: 'reset_requested', email: body.email, ip, userAgent: userAgent(req),
    });
  }

  return NextResponse.json({
    ok: true,
    message: 'If that address has an account, a reset link is on its way.',
  });
}

/** Spend a token and set the new password. */
export async function PUT(req: Request) {
  let body: z.infer<typeof ConsumeBody>;
  try {
    body = ConsumeBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'A token and a new password are required.' }, { status: 400 });
  }

  const db = getDb();
  try {
    const ok = consumeResetToken(db, body.token, body.password);
    if (!ok) {
      return NextResponse.json(
        { error: 'That reset link is no longer valid. Ask for a new one.' },
        { status: 400 },
      );
    }
  } catch (err) {
    // A weak password: the token survives so the user can try again.
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not reset.' }, { status: 400 });
  }

  recordAuthEvent(db, {
    event: 'password_changed', ip: clientIp(req), userAgent: userAgent(req),
  });
  return NextResponse.json({ ok: true });
}

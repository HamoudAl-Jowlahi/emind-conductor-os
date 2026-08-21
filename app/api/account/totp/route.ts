import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { enrollTotp, confirmTotp, disableTotp, totpEnabled, otpauthUrl } from '@/lib/totp';
import { verifyPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Where enrollment stands, without ever re-exposing a confirmed secret. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  return NextResponse.json({ enabled: totpEnabled(getDb(), user.id) });
}

/** Begin enrollment. Returns the secret ONCE, for the QR code. */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const db = getDb();
  if (totpEnabled(db, user.id)) {
    return NextResponse.json({ error: 'Two-factor is already on. Turn it off first.' }, { status: 400 });
  }

  const { secret } = enrollTotp(db, user.id);
  return NextResponse.json({ secret, otpauth: otpauthUrl(secret, user.email) });
}

const ConfirmBody = z.object({ code: z.string().min(4).max(10) });

/** Prove a code works, switch it on, hand back recovery codes once. */
export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  let body: z.infer<typeof ConfirmBody>;
  try {
    body = ConfirmBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });
  }

  try {
    const { recoveryCodes } = confirmTotp(getDb(), user.id, body.code.trim());
    return NextResponse.json({ ok: true, recoveryCodes });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not confirm.' }, { status: 400 });
  }
}

const DisableBody = z.object({ password: z.string().min(1) });

/**
 * Turning 2FA OFF is password-gated. A hijacked session must not be able to
 * quietly remove the very control that would have stopped it.
 */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  let body: z.infer<typeof DisableBody>;
  try {
    body = DisableBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Your password is required.' }, { status: 400 });
  }

  const db = getDb();
  const stored = db.users.byEmail(user.email);
  if (!stored || !verifyPassword(body.password, stored.passwordHash)) {
    return NextResponse.json({ error: 'That is not your password.' }, { status: 400 });
  }

  disableTotp(db, user.id);
  return NextResponse.json({ ok: true });
}

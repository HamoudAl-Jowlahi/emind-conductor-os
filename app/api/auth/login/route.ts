import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { authenticate, createSession, SESSION_COOKIE } from '@/lib/auth';
import { sessionCookieOptions } from '@/lib/session';
import { loginBlocked, recordAuthEvent } from '@/lib/auth-guard';
import { totpEnabled, verifyUserTotp, consumeRecoveryCode } from '@/lib/totp';
import { isEmailVerified } from '@/lib/email-verification';
import { clientIp, userAgent } from '@/lib/request-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // better-sqlite3 is native — keep off the edge

const Body = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  /** Present on the second step, once the password has already been accepted. */
  totp: z.string().min(4).max(20).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  const db = getDb();
  const ip = clientIp(req);
  const ua = userAgent(req);

  // Checked BEFORE verifying the password: scrypt is deliberately slow, so
  // answering a blocked attempt cheaply is also what stops the login route
  // from being a CPU amplifier.
  if (loginBlocked(db, body.email, ip)) {
    recordAuthEvent(db, { event: 'login_blocked', email: body.email, ip, userAgent: ua });
    return NextResponse.json(
      { error: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  const user = authenticate(db, body.email, body.password);
  // One message for both failure modes: naming which half was wrong turns the
  // login form into an account-enumeration oracle.
  if (!user) {
    recordAuthEvent(db, { event: 'login_failed', email: body.email, ip, userAgent: ua });
    return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
  }

  // An unproven address cannot sign in. Checked after the password so this
  // reveals nothing to someone who does not already hold the credentials.
  if (!isEmailVerified(db, user.id)) {
    recordAuthEvent(db, { event: 'login_failed', email: body.email, ip, userAgent: ua });
    return NextResponse.json(
      { error: 'Confirm your email address first — check your inbox.', needsVerification: true },
      { status: 403 },
    );
  }

  // Second factor, if this account has one. The password is already correct at
  // this point, so telling the client a code is needed reveals nothing it does
  // not already know — and no session exists until the code checks out.
  if (totpEnabled(db, user.id)) {
    if (!body.totp) {
      return NextResponse.json({ totpRequired: true }, { status: 401 });
    }
    const code = body.totp.trim();
    const ok = verifyUserTotp(db, user.id, code) || consumeRecoveryCode(db, user.id, code);
    if (!ok) {
      recordAuthEvent(db, { event: 'login_failed', email: body.email, ip, userAgent: ua });
      return NextResponse.json({ totpRequired: true, error: 'That code is not right.' }, { status: 401 });
    }
  }

  recordAuthEvent(db, { event: 'login_ok', email: user.email, userId: user.id, ip, userAgent: ua });
  const token = createSession(db, user.id);
  const res = NextResponse.json({ user: { name: user.name, email: user.email, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}

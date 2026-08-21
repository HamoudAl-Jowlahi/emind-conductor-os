import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { createUser, createSession, SESSION_COOKIE } from '@/lib/auth';
import { backfillRoster } from '@/lib/agents/roster';
import { passwordProblem, recordAuthEvent } from '@/lib/auth-guard';
import { issueVerificationToken, sendVerificationEmail, verificationUrl, markEmailVerified } from '@/lib/email-verification';
import { clientIp, userAgent } from '@/lib/request-context';
import { sessionCookieOptions } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

/**
 * Account creation.
 *
 * Two modes, chosen by SIGNUPS_OPEN:
 *
 *   unset / "0"  — first-run claim only. The route works while the install has
 *                  no users and 403s afterwards, so it cannot become a back
 *                  door for a second account. This is the safe default: a
 *                  fresh deployment is not accidentally open to the internet.
 *   "1"          — public signup. Anyone may register, each account starting
 *                  empty; only the first inherits the install's seeded data.
 *
 * The flag is deliberately opt-in rather than opt-out. Forgetting to close a
 * door is a far commoner mistake than forgetting to open one.
 */
export async function POST(req: Request) {
  const db = getDb();
  const isFirstUser = db.users.count() === 0;
  if (!isFirstUser && process.env.SIGNUPS_OPEN !== '1') {
    return NextResponse.json({ error: 'This install already has an operator.' }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues[0]?.message : 'Invalid details.';
    return NextResponse.json({ error: msg ?? 'Invalid details.' }, { status: 400 });
  }

  const weak = passwordProblem(body.password);
  if (weak) return NextResponse.json({ error: weak }, { status: 400 });

  const user = createUser(db, body);
  recordAuthEvent(db, {
    event: 'signup', email: user.email, userId: user.id,
    ip: clientIp(req), userAgent: userAgent(req),
  });

  // The first user inherits the install: the seeded rows have no owner yet,
  // and the full roster, because this account IS the install rather than a
  // guest joining one. Later accounts start empty and pick from the catalog.
  if (isFirstUser) {
    db.claimOrphanRows(user.id);
    backfillRoster(db, user.id);
    // The first account IS the install — it was created by whoever set the
    // server up, not by a stranger typing an address. Requiring confirmation
    // here would lock the operator out of their own system before mail is
    // even configured.
    markEmailVerified(db, user.id);
  } else {
    // Everyone else proves the address belongs to them before the account
    // can be used. Without this, "sign up" means "type any address".
    const token = issueVerificationToken(db, user.id);
    const origin = process.env.PUBLIC_ORIGIN ?? new URL(req.url).origin;
    await sendVerificationEmail(user.email, verificationUrl(origin, token));
  }

  const token = createSession(db, user.id);
  const res = NextResponse.json({ user: { name: user.name, email: user.email } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}

'use client';

/**
 * The sign-in screen, and — on a fresh install — the claim screen.
 *
 * One component for both because they are the same form with a different verb;
 * splitting them would duplicate the layout for a single extra field. Which
 * mode is active is decided on the server (`installNeedsSetup`), never by the
 * client, so nobody can flip themselves into setup mode to mint an account.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmindMark } from '@/components/EmindMark';

export function LoginForm({
  needsSetup,
  googleReady = false,
  notice,
}: {
  needsSetup: boolean;
  googleReady?: boolean;
  /** A message the Google callback bounced back, e.g. a cancelled sign-in. */
  notice?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);
  // The server asks for this only after the password is already accepted.
  const [totpNeeded, setTotpNeeded] = useState(false);
  const [totp, setTotp] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(needsSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(needsSetup ? { email, name, password } : { email, password, totp: totp || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string; totpRequired?: boolean; needsVerification?: boolean;
        };
        if (body.needsVerification) {
          setNeedsVerification(true);
          setError(body.error ?? null);
          return;
        }
        if (body.totpRequired) {
          setTotpNeeded(true);
          setError(body.error ?? null);
          return;
        }
        setError(body.error ?? 'Something went wrong. Try again.');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full border border-os-border bg-os-bg px-3 py-2.5 font-mono text-[13px] text-os-text outline-none transition-colors placeholder:text-os-dim focus:border-os-accent';
  const label = 'block font-mono text-[9.5px] font-bold uppercase tracking-[0.26em] text-os-muted';

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-[340px]">
        <div className="mb-9 flex items-center gap-3">
          <EmindMark size={38} className="shrink-0 text-os-accent" />
          <div>
            <div className="text-[13px] font-bold tracking-[0.14em]">EMIND</div>
            <div className="mt-[3px] font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">
              Conductor OS
            </div>
          </div>
        </div>

        <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.32em] text-os-dim">
          <span className="text-os-accent">// </span>
          {needsSetup ? 'First run' : 'Restricted'}
        </p>
        <h1 className="mt-2.5 text-[25px] font-bold uppercase leading-[1.1] tracking-[0.06em]">
          {needsSetup ? 'Claim this OS' : 'Sign in'}
        </h1>
        <p className="mt-2.5 text-[13px] leading-relaxed text-os-muted">
          {needsSetup
            ? 'No operator has claimed this install yet. The account you create here becomes the owner.'
            : 'This console is private. Sign in to continue.'}
        </p>

        {googleReady && (
          <div className="mt-7 flex flex-col gap-4">
            <a
              href="/api/auth/google"
              className="flex items-center justify-center gap-2.5 border border-os-border-bright px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-os-text transition-colors hover:border-os-text"
            >
              <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
              </svg>
              Continue with Google
            </a>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-os-border" />
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-os-dim">or</span>
              <span className="h-px flex-1 bg-os-border" />
            </div>
          </div>
        )}

        <form onSubmit={submit} className={`${googleReady ? 'mt-4' : 'mt-7'} flex flex-col gap-4`}>
          {needsSetup && (
            <div className="flex flex-col gap-1.5">
              <label className={label} htmlFor="name">Your name</label>
              <input id="name" className={field} value={name} onChange={(e) => setName(e.target.value)}
                autoComplete="name" required placeholder="Hamoud KJ" />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className={label} htmlFor="email">Email</label>
            <input id="email" type="email" className={field} value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="username" required
              placeholder="you@example.com" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={label} htmlFor="password">Password</label>
            <input id="password" type="password" className={field} value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={needsSetup ? 'new-password' : 'current-password'} required
              placeholder={needsSetup ? 'at least 10 characters' : ''} />
          </div>

          {totpNeeded && (
            <div className="flex flex-col gap-1.5">
              <label className={label} htmlFor="totp">Authentication code</label>
              <input id="totp" className={field} value={totp} onChange={(e) => setTotp(e.target.value)}
                autoComplete="one-time-code" inputMode="numeric" autoFocus required
                placeholder="6 digits, or a recovery code" />
              <p className="font-mono text-[10px] text-os-dim">From your authenticator app.</p>
            </div>
          )}

          {error && (
            <p role="alert" className="border-l-2 border-os-err py-1 pl-3 font-mono text-[11px] text-os-err">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy}
            className="mt-1 border border-os-accent bg-os-accent px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-os-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50">
            {busy ? 'Working…' : needsSetup ? 'Create operator' : totpNeeded ? 'Verify code' : 'Sign in'}
          </button>
        </form>

        {needsVerification && (
          <a href="/verify"
            className="mt-5 block border border-os-warn px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-os-warn transition-colors hover:bg-os-warn hover:text-os-bg">
            Send a new confirmation link
          </a>
        )}

        {!needsSetup && (
          <a href="/reset"
            className="mt-5 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-os-dim transition-colors hover:text-os-text">
            Forgot password?
          </a>
        )}

        <p className="mt-7 font-mono text-[10px] leading-relaxed text-os-dim">
          Sessions last 30 days. Signing out revokes the token server-side.
        </p>
      </div>
    </div>
  );
}

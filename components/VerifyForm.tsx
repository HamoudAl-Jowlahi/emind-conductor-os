'use client';

/**
 * Confirm an email address, or ask for a fresh link.
 *
 * The token is spent on mount rather than behind a button: the user already
 * expressed intent by clicking the link in their inbox, and making them click
 * again is friction with no security value.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { EmindMark } from '@/components/EmindMark';

const field =
  'w-full border border-os-border bg-os-bg px-3 py-2.5 font-mono text-[13px] text-os-text outline-none transition-colors placeholder:text-os-dim focus:border-os-accent';
const label = 'block font-mono text-[9.5px] font-bold uppercase tracking-[0.26em] text-os-muted';

type State = 'checking' | 'ok' | 'failed' | 'ask';

export function VerifyForm({ token }: { token?: string }) {
  const [state, setState] = useState<State>(token ? 'checking' : 'ask');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = useCallback(async (t: string) => {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t }),
    });
    if (res.ok) return setState('ok');
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? 'That link could not be confirmed.');
    setState('failed');
  }, []);

  useEffect(() => {
    if (token) void confirm(token);
  }, [token, confirm]);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/verify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? 'Could not send a link.');
    setSent(body.message ?? 'If that address needs confirming, a new link is on its way.');
  }

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
          <span className="text-os-accent">// </span>Email
        </p>
        <h1 className="mt-2.5 text-[25px] font-bold uppercase leading-[1.1] tracking-[0.06em]">
          {state === 'ok' ? 'Confirmed' : 'Confirm your email'}
        </h1>

        {state === 'checking' && (
          <p className="mt-5 font-mono text-[12px] text-os-muted">Checking your link…</p>
        )}

        {state === 'ok' && (
          <>
            <p className="mt-5 border-l-2 border-os-ok py-1 pl-3 font-mono text-[12px] leading-relaxed text-os-ok">
              Your address is confirmed. You can sign in now.
            </p>
            <Link href="/login"
              className="mt-7 inline-block border border-os-accent bg-os-accent px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-os-accent-ink transition-opacity hover:opacity-90">
              Go to sign in
            </Link>
          </>
        )}

        {(state === 'failed' || state === 'ask') && !sent && (
          <form onSubmit={resend} className="mt-7 flex flex-col gap-4">
            {state === 'failed' && error && (
              <p role="alert" className="border-l-2 border-os-err py-1 pl-3 font-mono text-[11px] text-os-err">
                {error}
              </p>
            )}
            <p className="text-[13px] leading-relaxed text-os-muted">
              Enter your address and we will send a fresh confirmation link.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className={label} htmlFor="verify-email">Email</label>
              <input id="verify-email" type="email" className={field} value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="username"
                placeholder="you@example.com" autoFocus required />
            </div>
            <button type="submit" disabled={busy}
              className="mt-1 border border-os-accent bg-os-accent px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-os-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50">
              {busy ? 'Sending…' : 'Send a new link'}
            </button>
          </form>
        )}

        {sent && (
          <p className="mt-5 border-l-2 border-os-ok py-1 pl-3 font-mono text-[12px] leading-relaxed text-os-ok">
            {sent}
          </p>
        )}

        <Link href="/login"
          className="mt-7 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-os-dim transition-colors hover:text-os-text">
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}

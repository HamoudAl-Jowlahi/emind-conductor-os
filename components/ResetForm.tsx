'use client';

/**
 * Password reset, both halves.
 *
 * The request half always reports the same thing whether or not the address
 * has an account — the server is deliberately silent about who is registered,
 * and the UI must not undo that by phrasing success and failure differently.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EmindMark } from '@/components/EmindMark';

const field =
  'w-full border border-os-border bg-os-bg px-3 py-2.5 font-mono text-[13px] text-os-text outline-none transition-colors placeholder:text-os-dim focus:border-os-accent';
const label = 'block font-mono text-[9.5px] font-bold uppercase tracking-[0.26em] text-os-muted';

export function ResetForm({ token }: { token?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function requestLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? 'Could not send a link.');
    setSent(body.message ?? 'If that address has an account, a reset link is on its way.');
  }

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/reset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? 'Could not reset your password.');
    setDone(true);
    setTimeout(() => router.replace('/login'), 1600);
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
          <span className="text-os-accent">// </span>
          {token ? 'New password' : 'Reset'}
        </p>
        <h1 className="mt-2.5 text-[25px] font-bold uppercase leading-[1.1] tracking-[0.06em]">
          {token ? 'Choose a password' : 'Forgot password'}
        </h1>

        {done ? (
          <p className="mt-5 border-l-2 border-os-ok py-1 pl-3 font-mono text-[12px] text-os-ok">
            Password changed. Taking you to sign in…
          </p>
        ) : token ? (
          <form onSubmit={setNewPassword} className="mt-7 flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-os-muted">
              Setting a new password signs out every device on this account.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className={label} htmlFor="new-password">New password</label>
              <input id="new-password" type="password" className={field} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
                placeholder="at least 10 characters" autoFocus required />
            </div>
            {error && (
              <p role="alert" className="border-l-2 border-os-err py-1 pl-3 font-mono text-[11px] text-os-err">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy}
              className="mt-1 border border-os-accent bg-os-accent px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-os-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50">
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </form>
        ) : sent ? (
          <p className="mt-5 border-l-2 border-os-ok py-1 pl-3 font-mono text-[12px] leading-relaxed text-os-ok">
            {sent}
          </p>
        ) : (
          <form onSubmit={requestLink} className="mt-7 flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-os-muted">
              We will email a link that works once and expires in an hour.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className={label} htmlFor="reset-email">Email</label>
              <input id="reset-email" type="email" className={field} value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="username"
                placeholder="you@example.com" autoFocus required />
            </div>
            {error && (
              <p role="alert" className="border-l-2 border-os-err py-1 pl-3 font-mono text-[11px] text-os-err">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy}
              className="mt-1 border border-os-accent bg-os-accent px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-os-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50">
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <Link href="/login"
          className="mt-7 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-os-dim transition-colors hover:text-os-text">
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}

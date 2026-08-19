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

export function LoginForm({ needsSetup }: { needsSetup: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(needsSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(needsSetup ? { email, name, password } : { email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
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

        <form onSubmit={submit} className="mt-7 flex flex-col gap-4">
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

          {error && (
            <p role="alert" className="border-l-2 border-os-err py-1 pl-3 font-mono text-[11px] text-os-err">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy}
            className="mt-1 border border-os-accent bg-os-accent px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-os-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50">
            {busy ? 'Working…' : needsSetup ? 'Create operator' : 'Sign in'}
          </button>
        </form>

        <p className="mt-7 font-mono text-[10px] leading-relaxed text-os-dim">
          Sessions last 30 days. Signing out revokes the token server-side.
        </p>
      </div>
    </div>
  );
}

'use client';

/**
 * Sign out.
 *
 * Calls the server rather than just clearing the cookie in the browser: the
 * session row is deleted server-side, so the token is dead even if a copy of
 * the cookie survives somewhere. Clearing it client-side alone would leave a
 * working credential behind.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function SignOutButton({ name }: { name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Whatever the server said, stop showing a signed-in screen. `replace`
      // rather than `push` so Back cannot land on a stale rendered page.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      title={`Signed in as ${name} — sign out`}
      className="flex w-full items-center gap-2 border border-os-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-os-muted transition-colors hover:border-os-border-bright hover:text-os-text disabled:opacity-50"
    >
      <LogOut className="h-3 w-3 shrink-0" />
      <span className="truncate">{busy ? 'Signing out…' : 'Sign out'}</span>
    </button>
  );
}

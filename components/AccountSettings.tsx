'use client';

/**
 * The account surface: who you are, your password, your devices, and the door
 * out. Each block owns its own state so one failing request cannot blank the
 * others, and every destructive action states its consequence before asking.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionHead } from '@/components/terminal';

type Props = {
  user: { name: string; email: string; role: string };
  sessionCount: number;
};

const field =
  'w-full border border-os-border bg-os-bg px-3 py-2.5 font-mono text-[13px] text-os-text outline-none transition-colors placeholder:text-os-dim focus:border-os-accent';
const label = 'block font-mono text-[9.5px] font-bold uppercase tracking-[0.26em] text-os-muted';
const button =
  'border border-os-border-bright px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] transition-colors disabled:opacity-50';

function Note({ kind, children }: { kind: 'ok' | 'err'; children: React.ReactNode }) {
  return (
    <p
      role={kind === 'err' ? 'alert' : 'status'}
      className={`border-l-2 py-1 pl-3 font-mono text-[11px] ${
        kind === 'err' ? 'border-os-err text-os-err' : 'border-os-ok text-os-ok'
      }`}
    >
      {children}
    </p>
  );
}

export function AccountSettings({ user, sessionCount }: Props) {
  const router = useRouter();

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [profileMsg, setProfileMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const [sessionMsg, setSessionMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingProfile(false);
    if (!res.ok) return setProfileMsg({ kind: 'err', text: body.error ?? 'Could not save.' });
    setProfileMsg({ kind: 'ok', text: 'Saved.' });
    router.refresh();
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPw(true);
    setPwMsg(null);
    const res = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingPw(false);
    if (!res.ok) return setPwMsg({ kind: 'err', text: body.error ?? 'Could not change it.' });
    setCurrentPassword('');
    setNewPassword('');
    setPwMsg({ kind: 'ok', text: 'Password changed. Every other device has been signed out.' });
    router.refresh();
  }

  async function signOutEverywhereElse() {
    const res = await fetch('/api/account/sessions', { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    setSessionMsg(res.ok ? `${body.revoked} other session(s) signed out.` : 'Could not sign them out.');
    router.refresh();
  }

  async function reallyDelete(e: React.FormEvent) {
    e.preventDefault();
    setDeleteMsg(null);
    const res = await fetch('/api/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: deletePassword }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setDeleteMsg(body.error ?? 'Could not delete the account.');
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-10">
      <section className="flex flex-col gap-4">
        <SectionHead label="Profile" />
        <form onSubmit={saveProfile} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className={label} htmlFor="name">Name</label>
            <input id="name" className={field} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={label} htmlFor="email">Email</label>
            <input id="email" type="email" className={field} value={email}
              onChange={(e) => setEmail(e.target.value)} required />
            <p className="font-mono text-[10px] text-os-dim">Used to sign in. It is not verified yet.</p>
          </div>
          {profileMsg && <Note kind={profileMsg.kind}>{profileMsg.text}</Note>}
          <button type="submit" disabled={savingProfile} className={`${button} self-start hover:border-os-text`}>
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead label="Password" />
        <form onSubmit={savePassword} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className={label} htmlFor="current">Current password</label>
            <input id="current" type="password" className={field} autoComplete="current-password"
              value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={label} htmlFor="next">New password</label>
            <input id="next" type="password" className={field} autoComplete="new-password"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="at least 10 characters" required />
          </div>
          {pwMsg && <Note kind={pwMsg.kind}>{pwMsg.text}</Note>}
          <button type="submit" disabled={savingPw} className={`${button} self-start hover:border-os-text`}>
            {savingPw ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHead label="Devices" />
        <p className="font-mono text-[11px] leading-relaxed text-os-muted">
          {sessionCount} active session{sessionCount === 1 ? '' : 's'}, including this one. Sessions last 30 days.
        </p>
        {sessionMsg && <Note kind="ok">{sessionMsg}</Note>}
        <button onClick={signOutEverywhereElse} className={`${button} self-start hover:border-os-text`}>
          Sign out everywhere else
        </button>
      </section>

      <section className="flex flex-col gap-4 border-t border-os-border pt-8">
        <SectionHead label="Delete account" />
        <p className="font-mono text-[11px] leading-relaxed text-os-muted">
          Permanently removes your agents, runs, conversations, funnel, finances and stored keys.
          This cannot be undone.
        </p>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className={`${button} self-start border-os-err text-os-err hover:bg-os-err hover:text-os-bg`}>
            Delete my account
          </button>
        ) : (
          <form onSubmit={reallyDelete} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={label} htmlFor="confirm-pw">Confirm with your password</label>
              <input id="confirm-pw" type="password" className={field} autoComplete="current-password"
                value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} required />
            </div>
            {deleteMsg && <Note kind="err">{deleteMsg}</Note>}
            <div className="flex gap-3">
              <button type="submit"
                className={`${button} border-os-err text-os-err hover:bg-os-err hover:text-os-bg`}>
                Delete permanently
              </button>
              <button type="button" onClick={() => { setConfirmDelete(false); setDeleteMsg(null); }}
                className={`${button} hover:border-os-text`}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

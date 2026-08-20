import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { currentUser } from '@/lib/session';
import { getDb } from '@/lib/data';
import { AccountSettings } from '@/components/AccountSettings';

export const dynamic = 'force-dynamic';

/**
 * Settings holds the ACCOUNT, not the work. API keys stay on /integrations
 * beside the service they unlock, agents stay on /agents, and the theme stays
 * in the topbar — burying a daily surface inside a rarely-opened page would be
 * a regression, not tidiness.
 */
export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <div>
      <PageHeader eyebrow="Account" title="Settings" />
      <AccountSettings
        user={{ name: user.name, email: user.email, role: user.role }}
        sessionCount={getDb().sessions.byUser(user.id).length}
      />
    </div>
  );
}

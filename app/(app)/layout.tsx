import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { ConductorPanel } from '@/components/ConductorPanel';
import { buildCommands } from '@/lib/palette-commands';
import { currentUser } from '@/lib/session';

/**
 * The authenticated shell. Every page under (app) is inside this layout, and
 * `/login` deliberately is not — which is what makes the guard airtight and
 * loop-free: an unauthenticated request is redirected out of the group instead
 * of being handed a layout that has to decide whether to render itself.
 *
 * The check is authoritative (a real session lookup), not a cookie sniff, so a
 * forged cookie gets no further than middleware's cheap first pass.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <>
      <Sidebar />
      {/* os-shell yields to the Conductor dock: the panel sets --conductor-w
          and the whole content column glides left instead of being covered */}
      <div className="os-shell ml-[232px] flex min-h-screen min-w-0 flex-col" style={{ marginRight: 'var(--conductor-w, 0px)' }}>
        <Topbar />
        <main className="min-w-0 flex-1 px-8 pb-16 pt-7 wide:px-10 ultra:px-12">
          {/* Width tiers: 1280 on laptops · 1760 on large monitors ·
              full-bleed on 32"/ultrawide. See tailwind screens wide/ultra. */}
          <div className="mx-auto max-w-[1280px] wide:max-w-[1760px] ultra:max-w-none">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette commands={buildCommands()} />
      {/* Notion-style agent dock — the Conductor, aware of the current screen */}
      <ConductorPanel />
    </>
  );
}

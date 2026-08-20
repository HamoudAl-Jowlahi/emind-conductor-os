import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/data';
import { currentUser } from '@/lib/session';
import { catalogFor } from '@/lib/agents/roster';
import { PageHeader } from '@/components/PageHeader';
import { AgentCatalog } from '@/components/AgentCatalog';

export const dynamic = 'force-dynamic';

export default async function AgentCatalogPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const catalog = catalogFor(getDb(), user.id);
  const installed = catalog.filter((c) => c.installed).length;

  return (
    <div>
      <Link
        href="/agents"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-os-muted transition-colors hover:text-os-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to your crew
      </Link>

      <PageHeader
        eyebrow="Catalog"
        title="Agent catalog"
        right={
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-os-muted">
            {installed} / {catalog.length} installed
          </span>
        }
      />

      <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-os-muted">
        Every agent here has a real implementation. Install the ones that match how you work — your
        crew is what you choose, not everything on offer. Each card lists the connector keys the
        agent needs before it can do anything useful.
      </p>

      <AgentCatalog initial={catalog} />
    </div>
  );
}

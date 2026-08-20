'use client';

/**
 * The catalog grid: every agent on offer, each card carrying what the agent
 * does, which pillar it serves, and — the part that decides whether it is
 * worth installing — the connector keys it needs.
 *
 * State comes back from the server on every action rather than being patched
 * locally, so the page can never drift from what is actually installed.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import type { CatalogEntry } from '@/lib/agents/roster';
import { Badge, Dot } from '@/components/terminal';

export function AgentCatalog({ initial }: { initial: CatalogEntry[] }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(agentId: string, action: 'install' | 'uninstall' | 'enable' | 'disable') {
    setBusy(agentId);
    setError(null);
    try {
      const res = await fetch('/api/agents/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, action }),
      });
      const body = (await res.json()) as { catalog?: CatalogEntry[]; error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not update your crew.');
        return;
      }
      if (body.catalog) setCatalog(body.catalog);
      router.refresh(); // the sidebar count and /agents follow along
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  const byDept = catalog.reduce<Record<string, CatalogEntry[]>>((acc, entry) => {
    (acc[entry.department] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <div className="mt-8 flex flex-col gap-8">
      {error && (
        <p role="alert" className="border-l-2 border-os-err py-1 pl-3 font-mono text-[11px] text-os-err">
          {error}
        </p>
      )}

      {Object.entries(byDept).map(([dept, entries]) => (
        <section key={dept}>
          <h2 className="mb-3 flex items-center gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-os-muted">
            {dept}
            <span className="h-px flex-1 bg-os-border" />
            <span className="text-os-dim">{entries.filter((e) => e.installed).length}/{entries.length}</span>
          </h2>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => (
              <article
                key={entry.id}
                className="flex flex-col gap-3 border border-os-border bg-os-surface p-4 transition-colors hover:border-os-border-bright"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Dot state={entry.installed && entry.enabled ? "ok" : "dim"} />
                      <h3 className="truncate text-[13px] font-bold tracking-wide">{entry.name}</h3>
                    </div>
                    <div className="mt-1 truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">
                      {entry.role || entry.tier}
                    </div>
                  </div>
                  {entry.tier === 'lead' && <Badge>lead</Badge>}
                </div>

                <p className="text-[12px] leading-relaxed text-os-muted">{entry.description}</p>

                {entry.tools.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">needs</span>
                    {entry.tools.map((t) => (
                      <span
                        key={t}
                        className="border border-os-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-os-muted"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center gap-2 pt-1">
                  {entry.installed ? (
                    <>
                      <button
                        onClick={() => act(entry.id, entry.enabled ? 'disable' : 'enable')}
                        disabled={busy === entry.id}
                        className="border border-os-border px-3 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-os-muted transition-colors hover:border-os-text hover:text-os-text disabled:opacity-50"
                      >
                        {entry.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => act(entry.id, 'uninstall')}
                        disabled={busy === entry.id}
                        className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim transition-colors hover:text-os-err disabled:opacity-50"
                      >
                        Remove
                      </button>
                      <span className="ml-auto flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-os-ok">
                        <Check className="h-3 w-3" /> installed
                      </span>
                    </>
                  ) : (
                    <button
                      onClick={() => act(entry.id, 'install')}
                      disabled={busy === entry.id}
                      className="flex items-center gap-1.5 border border-os-accent bg-os-accent px-3 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-os-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" />
                      {busy === entry.id ? 'Adding…' : 'Install'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

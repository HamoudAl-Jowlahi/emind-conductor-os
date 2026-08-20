import { beforeAll, describe, expect, test } from 'vitest';
import { signInTestUser } from './helpers/session';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Pages read the DB path at first access, so point it at a fresh seeded temp DB
// before any page module is imported. FUNNEL_PROVIDER keeps /funnel off the
// live Attio API in tests.
beforeAll(async () => {
  // Pages read the signed-in user's scoped handle, so the smoke net needs a
  // session before it can render anything.
  process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'founder-os-smoke-')), 'test.db');
  process.env.FUNNEL_PROVIDER = 'seed';
  process.env.GBRAIN_BIN = path.join(tmpdir(), 'founder-os-no-gbrain-cli');
  await signInTestUser();
});

type PageEntry = {
  file: string; // path relative to app/, the source of truth for coverage
  // props is `any` so strongly-typed page components (e.g. /org's searchParams)
  // remain assignable to this generic invoker.
  load: () => Promise<{ default: (props?: any) => unknown }>;
  props?: unknown;
};

// Every app/**/page.tsx, with the props each needs to be invoked.
const PAGES: PageEntry[] = [
  { file: 'page.tsx', load: () => import('@/app/(app)/page') },
  { file: 'comms/page.tsx', load: () => import('@/app/(app)/comms/page') },
  { file: 'social/page.tsx', load: () => import('@/app/(app)/social/page') },
  { file: 'social/[platform]/page.tsx', load: () => import('@/app/(app)/social/[platform]/page'), props: { params: Promise.resolve({ platform: 'instagram' }) } },
  { file: 'social/beehiiv/page.tsx', load: () => import('@/app/(app)/social/beehiiv/page') },
  { file: 'content/page.tsx', load: () => import('@/app/(app)/content/page') },
  { file: 'agents/page.tsx', load: () => import('@/app/(app)/agents/page') },
  { file: 'agents/catalog/page.tsx', load: () => import('@/app/(app)/agents/catalog/page') },
  { file: 'tasks/page.tsx', load: () => import('@/app/(app)/tasks/page') },
  { file: 'skills/page.tsx', load: () => import('@/app/(app)/skills/page') },
  { file: 'org/page.tsx', load: () => import('@/app/(app)/org/page'), props: { searchParams: Promise.resolve({}) } },
  { file: 'brain/page.tsx', load: () => import('@/app/(app)/brain/page') },
  { file: 'finances/page.tsx', load: () => import('@/app/(app)/finances/page') },
  { file: 'funnel/page.tsx', load: () => import('@/app/(app)/funnel/page'), props: { searchParams: Promise.resolve({}) } },
  { file: 'workflows/page.tsx', load: () => import('@/app/(app)/workflows/page') },
  { file: 'integrations/page.tsx', load: () => import('@/app/(app)/integrations/page') },
  { file: 'roadmap/page.tsx', load: () => import('@/app/(app)/roadmap/page') },
  { file: 'analytics/page.tsx', load: () => import('@/app/(app)/analytics/page') },
  { file: 'reference/page.tsx', load: () => import('@/app/(app)/reference/page') },
  { file: 'settings/page.tsx', load: () => import('@/app/(app)/settings/page') },
  { file: 'personas/page.tsx', load: () => import('@/app/(app)/personas/page') },
];

function discoverPages(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...discoverPages(path.join(dir, entry.name), rel));
    else if (entry.name === 'page.tsx') out.push(rel);
  }
  return out;
}

describe('platform smoke — every page renders without throwing', () => {
  // 20s: pages that shell out to the gbrain CLI or distill the brain-store
  // (/, /brain) legitimately exceed vitest's 5s default under a loaded
  // parallel suite — this is a does-it-throw net, not a performance gate.
  // The signed-out guard is pinned in tests/auth.test.ts; this net signs in so
  // it can do its own job — proving each page renders with real data.
  test.each(PAGES)('$file renders', async ({ load, props }) => {
    const mod = await load();
    const Page = mod.default;
    // Server components run their body (DB reads, data fetch) when invoked;
    // a throw here is exactly the failure we want to catch.
    await expect(Promise.resolve(Page(props))).resolves.toBeTruthy();
  }, 20_000);

  test('the smoke net covers every app/**/page.tsx (no page escapes)', () => {
    const discovered = discoverPages(path.join(process.cwd(), 'app', '(app)')).sort();
    const covered = PAGES.map((p) => p.file).sort();
    expect(covered).toEqual(discovered);
  });
});

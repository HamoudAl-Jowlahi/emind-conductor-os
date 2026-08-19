/**
 * Command-palette contents: the fixed nav entries plus everything the database
 * knows about (agents, tools). Lifted out of the root layout when the auth
 * guard moved the chrome into the (app) group — the palette is part of the
 * signed-in shell, not of the document shell.
 */
import { getDb } from '@/lib/data';
import type { Command } from '@/lib/palette';

const NAV_COMMANDS: Command[] = [
  { id: 'nav-home', label: 'Home', keywords: 'dashboard today overview start', href: '/', hint: 'view' },
  { id: 'nav-social', label: 'Social', keywords: 'instagram tiktok twitter x youtube linkedin followers growth zernio audience', href: '/social', hint: 'view' },
  { id: 'nav-comms', label: 'Comms', keywords: 'messages email whatsapp slack inbox unified feed', href: '/comms', hint: 'view' },
  { id: 'nav-agents', label: 'Agents', keywords: 'runtime run real roster', href: '/agents', hint: 'view' },
  { id: 'nav-connections', label: 'Connections', keywords: 'integrations tools status creds', href: '/integrations', hint: 'view' },
  { id: 'nav-roadmap', label: 'Roadmap', keywords: 'plan phases quarters', href: '/roadmap', hint: 'view' },
  { id: 'nav-analytics', label: 'Analytics', keywords: 'metrics numbers', href: '/analytics', hint: 'view' },
  { id: 'nav-reference', label: 'Reference Model', keywords: 'domains business brm', href: '/reference', hint: 'view' },
  { id: 'nav-org', label: 'Org Chart', keywords: 'org chart hierarchy departments tree structure leads specialists', href: '/org', hint: 'view' },
  { id: 'nav-brain', label: 'G-Brain', keywords: 'brain knowledge core markdown vector pgvector supabase embeddings zeroentropy graph doctor', href: '/brain', hint: 'view' },
  // Local apps discovered on this machine — open in a new tab
  { id: 'ext-command-center', label: 'Command Center', keywords: 'command-center kanban missions port 4000', href: 'http://localhost:4000', hint: 'localhost' },
  { id: 'ext-remotion', label: 'Remotion Studio', keywords: 'video render pipeline port 3789', href: 'http://localhost:3789', hint: 'localhost' },
  { id: 'ext-skool', label: 'Skool Community', keywords: 'launchpad cohort community posts', href: 'https://www.skool.com/launchpad-cohort', hint: 'web' },
  { id: 'ext-attio', label: 'Attio CRM', keywords: 'deals pipeline vantage', href: 'https://app.attio.com', hint: 'web' },
  { id: 'ext-fathom', label: 'Fathom Calls', keywords: 'meetings recordings notes', href: 'https://fathom.video', hint: 'web' },
];

export function buildCommands(): Command[] {
  const db = getDb();
  const tools: Command[] = db.tools.all().map((t) => ({
    id: `tool-${t.id}`,
    label: t.name,
    keywords: `${t.category} ${t.description}`,
    href: '/integrations',
    hint: 'tool',
  }));
  const agents: Command[] = db.agents.all().map((a) => ({
    id: `agent-${a.id}`,
    label: a.name,
    keywords: `${a.role} ${a.description}`,
    href: '/agents',
    hint: 'agent',
  }));
  return [...NAV_COMMANDS, ...agents, ...tools];
}

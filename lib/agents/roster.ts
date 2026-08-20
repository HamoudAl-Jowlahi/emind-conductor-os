/**
 * The roster — the single source of truth for "which agents does this user
 * have".
 *
 * Before the install layer, every screen read `db.agents.all()` directly and
 * got the same fixed 19. That was fine for one operator and wrong for many:
 * a roster has to be per-user, and it has to be the SAME per-user answer
 * everywhere. Thirteen call sites reading the table independently would drift
 * the moment one of them forgot to scope.
 *
 * So the rule is: screens ask this module, never the table.
 *
 *   rosterFor()        the user's active agents, as database rows (display)
 *   runtimeRosterFor() the same set, as executable agents (run / chat / cron)
 *   catalogFor()       everything on offer, each flagged with install state
 *
 * "Active" means installed AND enabled. A disabled agent stays installed —
 * the user keeps their config and can switch it back on — but it must not
 * appear in the roster, must not execute, and must not receive broadcasts.
 */
import { realAgents } from '@/lib/agents/real';
import type { FounderDb } from '@/lib/db';
import type { RuntimeAgent } from '@/lib/agents/runtime';
import type { Agent } from '@/lib/schemas';

export type CatalogEntry = {
  id: string;
  name: string;
  role: string;
  description: string;
  department: string;
  departmentId: string;
  tier: string;
  /** Connector keys this agent needs — shown on the card before installing. */
  tools: string[];
  installed: boolean;
  enabled: boolean;
};

/** Catalog agents are the ones with an implementation in code. */
const builtinIds = (): Set<string> => new Set(realAgents.map((a) => a.id));

/** Installed AND enabled ids, in install order. */
function activeIds(db: FounderDb, userId: string): string[] {
  return db.userAgents
    .forUser(userId)
    .filter((ua) => ua.enabled)
    .map((ua) => ua.agentId);
}

/** The user's active agents as database rows — for every display surface. */
export function rosterFor(db: FounderDb, userId: string): Agent[] {
  const active = new Set(activeIds(db, userId));
  return db.agents.all().filter((a) => active.has(a.id));
}

/** The same set, executable. Anything not installed simply cannot run. */
export function runtimeRosterFor(db: FounderDb, userId: string): RuntimeAgent[] {
  const active = new Set(activeIds(db, userId));
  return realAgents.filter((a) => active.has(a.id));
}

/** Everything on offer, flagged with this user's install state. */
export function catalogFor(db: FounderDb, userId: string): CatalogEntry[] {
  const installed = new Map(db.userAgents.forUser(userId).map((ua) => [ua.agentId, ua]));
  const departments = new Map(db.departments.all().map((d) => [d.id, d.name]));
  const available = builtinIds();

  return db.agents
    .all()
    .filter((a) => available.has(a.id))
    .map((a) => {
      const ua = installed.get(a.id);
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        description: a.description,
        department: departments.get(a.departmentId) ?? a.departmentId,
        departmentId: a.departmentId,
        tier: a.tier,
        tools: a.tools,
        installed: Boolean(ua),
        enabled: ua?.enabled ?? false,
      };
    });
}

export function installAgent(db: FounderDb, userId: string, agentId: string): void {
  // Refuse unknown ids loudly. A silent no-op here would show the user a
  // successful install for an agent that can never run.
  if (!builtinIds().has(agentId)) throw new Error(`unknown agent: ${agentId}`);
  db.userAgents.install({
    userId,
    agentId,
    source: 'builtin',
    enabled: true,
    config: {},
    installedAt: new Date().toISOString(),
  });
}

export function uninstallAgent(db: FounderDb, userId: string, agentId: string): void {
  db.userAgents.uninstall(userId, agentId);
}

export function setAgentEnabled(db: FounderDb, userId: string, agentId: string, enabled: boolean): void {
  db.userAgents.setEnabled(userId, agentId, enabled);
}

/** Does this user have this agent active? The guard for run/chat routes. */
export function hasAgent(db: FounderDb, userId: string, agentId: string): boolean {
  const ua = db.userAgents.get(userId, agentId);
  return Boolean(ua?.enabled);
}

/**
 * Give an existing user the full built-in roster.
 *
 * Used once per user when upgrading an install that predates the catalog:
 * those users already had all 19 agents implicitly, and quietly emptying
 * their roster on upgrade would be a regression, not a feature.
 *
 * It is NOT a reset button: it does nothing for a user who already has any
 * roster row, so an agent they deliberately uninstalled stays uninstalled.
 *
 * The one gap that guard leaves — a user who uninstalls every agent would be
 * refilled — is closed by WHERE this is called from: the migration only, once,
 * for users that predate the table. Do not call it from a request path.
 */
export function backfillRoster(db: FounderDb, userId: string): void {
  if (db.userAgents.forUser(userId).length > 0) return;
  const now = new Date().toISOString();
  for (const agent of realAgents) {
    db.userAgents.install({
      userId,
      agentId: agent.id,
      source: 'builtin',
      enabled: true,
      config: {},
      installedAt: now,
    });
  }
}

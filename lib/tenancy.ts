/**
 * Which tables hold one user's data, and which are shared catalog.
 *
 * This is the load-bearing decision of the multi-user model, so it lives in
 * code rather than in someone's head: a table that is misfiled as SHARED leaks
 * one user's work to everyone, and one misfiled as OWNED makes the catalog
 * invisible. A test asserts that every table in the schema appears in exactly
 * one list, so adding a table without classifying it fails the build.
 *
 * The line: does this row describe THE PRODUCT, or THIS PERSON'S BUSINESS?
 */

/** Shared across everyone — the catalog of what the product offers. */
export const SHARED_TABLES = [
  'departments', // the six pillars; structure, not content
  'agents', // catalog definitions — who is installable
  'tools', // connector catalog
  'skills', // reusable skill catalog
  'personas', // template personas
  'domains', // reference model
  'phases', // reference model
] as const;

/** Identity and membership — scoped by construction, not by a added column. */
export const IDENTITY_TABLES = ['users', 'sessions', 'user_agents', 'agent_crons'] as const;

/** One person's business. Every read MUST be filtered by user_id. */
export const OWNED_TABLES = [
  'agent_runs',
  'agent_messages',
  'agent_tasks',
  'broadcasts',
  'broadcast_replies',
  'contact_tags',
  'people',
  'sop_tasks',
  'funnel_contacts',
  'funnel_touches',
  'workflows',
  'roadmap_items',
  'metrics',
  'social_accounts',
  'social_snapshots',
  'social_posts',
  'social_dms',
  'social_dm_snapshots',
  'social_dm_messages',
  'email_list_snapshots',
] as const;

export type OwnedTable = (typeof OWNED_TABLES)[number];

export const ALL_CLASSIFIED: string[] = [...SHARED_TABLES, ...IDENTITY_TABLES, ...OWNED_TABLES];

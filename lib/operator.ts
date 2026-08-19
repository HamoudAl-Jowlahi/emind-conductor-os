/**
 * Operator identity — the single source of truth for who this OS belongs to.
 *
 * Every screen that greets, signs, or attributes something to the human runs
 * through here instead of hard-coding a name. Three reasons this exists:
 *
 *  1. The identity used to be spelled out in 27 places across seed data,
 *     pages, and the knowledge graph. Changing owner meant a find-and-replace
 *     across the codebase, and one missed spot leaked the previous owner.
 *  2. It is configurable per install via env, so the same build serves any
 *     operator without a rebuild.
 *  3. When auth lands, `resolveOperator()` becomes the seam: it starts
 *     returning the signed-in user instead of the env defaults, and every
 *     call site is already correct.
 *
 * Defaults are deliberately generic — a fresh clone belongs to nobody until
 * its owner says otherwise.
 */

export type Operator = {
  /** Short form used in greetings: "Good evening, {name}". */
  name: string;
  /** Full display name for the org chart and formal attribution. */
  fullName: string;
  /** Title shown beside the name. */
  role: string;
  /** Social handle, without the leading @. */
  handle: string;
  /** Public site, no protocol. Empty string means "none configured". */
  site: string;
};

export const OPERATOR: Operator = {
  name: process.env.OPERATOR_NAME ?? 'Operator',
  fullName: process.env.OPERATOR_FULL_NAME ?? process.env.OPERATOR_NAME ?? 'Operator',
  role: process.env.OPERATOR_ROLE ?? 'Founder',
  handle: process.env.OPERATOR_HANDLE ?? 'your.handle',
  site: process.env.OPERATOR_SITE ?? '',
};

/** `@handle` — the form used in social copy and account labels. */
export const operatorHandle = (): string => `@${OPERATOR.handle}`;

/** "Name · Role" — the owner string used by workflows and SOP tables. */
export const operatorOwner = (): string => `${OPERATOR.name} · ${OPERATOR.role}`;

/**
 * The seam for authentication. Today it returns the env-configured operator;
 * once sessions exist it takes the signed-in user and every call site follows
 * without further change.
 */
export function resolveOperator(): Operator {
  return OPERATOR;
}

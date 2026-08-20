/**
 * The scoped-handle entry point.
 *
 * Code serving a request must never hold the unscoped handle: `forUser` is the
 * only supported way to reach one person's data, and the filter it applies
 * lives inside the repositories rather than in the caller. A page that forgets
 * to scope cannot exist, because a page never writes the WHERE clause.
 */
import type { FounderDb } from '@/lib/db';

/** The same connection, seen as one user. */
export function forUser(db: FounderDb, userId: string): FounderDb {
  return db.withUser(userId);
}

/** True for the unscoped handle — seeding, migrations, the scheduler. */
export function isUnscoped(db: FounderDb): boolean {
  return db.scopedTo === null;
}

import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { ResetForm } from '@/components/ResetForm';

export const dynamic = 'force-dynamic';

/**
 * Two screens, one route: ask for a link, or set a new password with the token
 * from that link. Which one shows is decided by the presence of the token, so
 * a user who clicks their email lands directly on the form that matters.
 *
 * Sits outside the (app) group, like /login — a locked-out user has no session
 * by definition, so putting this behind the guard would make it unreachable.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  if (await currentUser()) redirect('/');
  const sp = await searchParams;
  return <ResetForm token={sp?.token} />;
}

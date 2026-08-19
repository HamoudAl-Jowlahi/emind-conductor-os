import { redirect } from 'next/navigation';
import { currentUser, installNeedsSetup } from '@/lib/session';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Already signed in? The login screen has nothing to offer.
  if (await currentUser()) redirect('/');
  return <LoginForm needsSetup={installNeedsSetup()} />;
}

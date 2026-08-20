import { redirect } from 'next/navigation';
import { currentUser, installNeedsSetup } from '@/lib/session';
import { googleConfigured } from '@/lib/google-oauth';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  // Already signed in? The login screen has nothing to offer.
  if (await currentUser()) redirect('/');
  const sp = await searchParams;
  return (
    <LoginForm
      needsSetup={installNeedsSetup()}
      googleReady={googleConfigured()}
      notice={sp?.error}
    />
  );
}

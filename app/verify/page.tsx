import { VerifyForm } from '@/components/VerifyForm';

export const dynamic = 'force-dynamic';

/**
 * Where a confirmation link lands. Public by necessity: the person clicking it
 * has no session yet — that is the whole point of confirming.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  return <VerifyForm token={sp?.token} />;
}

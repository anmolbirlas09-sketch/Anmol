import 'server-only';
import { redirect } from 'next/navigation';
import { isOwner, requireUser } from '@/lib/auth';

/** Settings pages are for the owner; others go back to the hub, which explains. */
export async function requireOwner() {
  const user = await requireUser();
  if (!isOwner(user)) redirect('/settings');
  return user;
}

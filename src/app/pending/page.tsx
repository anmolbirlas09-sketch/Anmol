import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { L } from '@/lib/labels';
import { AuthShell } from '../AuthShell';
import { signOut } from '../auth-actions';

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.active) redirect('/');
  return (
    <AuthShell title={L.auth.pendingTitle}>
      <p className="text-muted">{L.auth.pendingBody}</p>
      <p className="mt-3 text-sm">{user.email}</p>
      <form action={signOut} className="mt-5">
        <button className="font-semibold text-brand">{L.app.signOut}</button>
      </form>
    </AuthShell>
  );
}

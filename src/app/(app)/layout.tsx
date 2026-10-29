import Link from 'next/link';
import { signOut } from '@/app/auth-actions';
import { Nav } from '@/components/Nav';
import { requireUser } from '@/lib/auth';
import { listFactories } from '@/lib/data/masters';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const factories = await listFactories(await createClient());
  const factory = factories.find((f) => f.id === user.factory_id);

  return (
    <div className="min-h-dvh pb-20 md:pb-8">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-bold">
              {L.app.name}
            </Link>
            <Nav variant="top" />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="max-w-36 truncate text-sm font-semibold">{user.name}</div>
              <div className="text-xs text-muted">
                {L.roles[user.role]} · {factory?.code ?? L.app.allFactories}
              </div>
            </div>
            <form action={signOut}>
              <button className="min-h-10 rounded-md px-2 text-sm font-semibold text-brand">{L.app.signOut}</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4">{children}</main>
      <Nav variant="bottom" />
    </div>
  );
}

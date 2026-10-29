import type { Metadata } from 'next';
import { Badge, Card, PageHeader } from '@/components/ui';
import { listFactories } from '@/lib/data/masters';
import { listUsers } from '@/lib/data/settings';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { requireOwner } from '../owner';
import { UserForm } from '../SettingsForms';

export const metadata: Metadata = { title: L.settings.users };

export default async function UsersPage() {
  const me = await requireOwner();
  const db = await createClient();
  const [users, factories] = await Promise.all([listUsers(db), listFactories(db)]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={L.settings.users} back="/settings" />
      <ul className="space-y-3">
        {users.map((u) => (
          <li key={u.id}>
            <Card>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-bold">{u.email}</span>
                {u.id === me.id && <Badge tone="brand">{L.settings.you}</Badge>}
                {!u.active && <Badge tone="warn">{L.settings.pending}</Badge>}
              </div>
              <UserForm user={u} factories={factories} isMe={u.id === me.id} />
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

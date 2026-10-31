import type { Metadata } from 'next';
import { Card, PageHeader, SectionTitle } from '@/components/ui';
import { listFactories, listSpecifications } from '@/lib/data/masters';
import { listLooms } from '@/lib/data/settings';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { requireOwner } from '../owner';
import { LoomForm } from '../SettingsForms';

export const metadata: Metadata = { title: L.settings.looms };

export default async function LoomSettingsPage() {
  await requireOwner();
  const db = await createClient();
  const [looms, factories, specs] = await Promise.all([listLooms(db), listFactories(db), listSpecifications(db)]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={L.settings.looms} back="/settings" />
      <Card>
        <h2 className="mb-2 font-semibold">{L.settings.addLoom}</h2>
        <LoomForm loom={null} factories={factories} />
      </Card>
      {factories.map((f) => (
        <section key={f.id}>
          <SectionTitle>{f.code}</SectionTitle>
          <Card className="divide-y divide-line p-0">
            {looms.filter((l) => l.factory_id === f.id).map((l) => (
              <div key={l.id} className="px-3 py-2">
                <LoomForm loom={l} factories={factories} specs={specs} />
              </div>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}

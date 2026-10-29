import type { Metadata } from 'next';
import { Card, PageHeader, SectionTitle } from '@/components/ui';
import { listAllFactories } from '@/lib/data/settings';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { requireOwner } from '../owner';
import { FactoryForm } from '../SettingsForms';

export const metadata: Metadata = { title: L.settings.factories };

export default async function FactorySettingsPage() {
  await requireOwner();
  const factories = await listAllFactories(await createClient());
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={L.settings.factories} back="/settings" />
      <Card className="divide-y divide-line p-0">
        {factories.map((f) => (
          <div key={f.id} className="p-3"><FactoryForm factory={f} /></div>
        ))}
      </Card>
      <SectionTitle>{L.settings.addFactory}</SectionTitle>
      <Card><FactoryForm factory={null} /></Card>
    </div>
  );
}

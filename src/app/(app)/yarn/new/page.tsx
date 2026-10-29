import type { Metadata } from 'next';
import { Notice, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { listFactories, listSuppliers, listYarnQualities } from '@/lib/data/masters';
import { todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { InwardForm } from './InwardForm';

export const metadata: Metadata = { title: L.yarn.newLot };

export default async function NewLotPage({ searchParams }: PageProps<'/yarn/new'>) {
  const user = await requireUser();
  const { saved } = await searchParams;
  const db = await createClient();
  const [qualities, suppliers, factories] = await Promise.all([
    listYarnQualities(db, { activeOnly: true }),
    listSuppliers(db, { activeOnly: true }),
    listFactories(db),
  ]);
  const allowed = user.factory_id ? factories.filter((f) => f.id === user.factory_id) : factories;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={L.yarn.newLot} back="/yarn" />
      {typeof saved === 'string' && (
        <div className="mb-4">
          <Notice tone="ok">{L.yarn.saved(saved)}</Notice>
        </div>
      )}
      <InwardForm
        qualities={qualities}
        suppliers={suppliers}
        factories={allowed}
        defaultFactoryId={user.factory_id ?? undefined}
        today={todayIST()}
      />
    </div>
  );
}

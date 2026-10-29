import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { listFabricQualities, listFactories } from '@/lib/data/masters';
import { todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { GreyAdjustForm } from '../AdjustForms';

export const metadata: Metadata = { title: L.adjust.greyTitle };

export default async function GreyAdjustPage() {
  const user = await requireUser();
  if (!canEdit(user)) redirect('/grey');
  const db = await createClient();
  const [qualities, factories] = await Promise.all([listFabricQualities(db, { activeOnly: true }), listFactories(db)]);
  const allowed = user.factory_id ? factories.filter((f) => f.id === user.factory_id) : factories;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={L.adjust.greyTitle} back="/grey" />
      <Card>
        <GreyAdjustForm qualities={qualities} factories={allowed} defaultFactoryId={user.factory_id ?? undefined} today={todayIST()} />
      </Card>
    </div>
  );
}

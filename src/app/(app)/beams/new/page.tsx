import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { listFabricQualities, listFactories, listSpecifications } from '@/lib/data/masters';
import { todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { BeamForm } from './BeamForm';

export const metadata: Metadata = { title: L.beam.newBeam };

export default async function NewBeamPage() {
  const user = await requireUser();
  const db = await createClient();
  const [qualities, factories, specs] = await Promise.all([listFabricQualities(db, { activeOnly: true }), listFactories(db), listSpecifications(db, { activeOnly: true })]);
  const allowed = user.factory_id ? factories.filter((f) => f.id === user.factory_id) : factories;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={L.beam.newBeam} back="/beams" />
      <BeamForm qualities={qualities} specs={specs} factories={allowed} defaultFactoryId={user.factory_id ?? undefined} today={todayIST()} />
    </div>
  );
}

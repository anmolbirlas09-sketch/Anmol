import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { listLoomStatus } from '@/lib/data/looms';
import { listFabricQualities, listFactories, listSpecifications, listYarnQualities } from '@/lib/data/masters';
import { L } from '@/lib/labels';
import { uuidParam } from '@/lib/params';
import { createClient } from '@/lib/supabase/server';
import { BeamCardForm } from '../BeamCardForm';

export const metadata: Metadata = { title: L.card.newTitle };

export default async function NewBeamPage({ searchParams }: PageProps<'/beams/new'>) {
  const user = await requireUser();
  const { loom } = await searchParams;
  const db = await createClient();
  const [qualities, factories, specs, yarns, looms] = await Promise.all([
    listFabricQualities(db, { activeOnly: true }), listFactories(db), listSpecifications(db, { activeOnly: true }),
    listYarnQualities(db, { activeOnly: true }), listLoomStatus(db, { factoryId: user.factory_id ?? undefined }),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={L.card.newTitle} back="/beams" />
      <BeamCardForm qualities={qualities} specs={specs} yarns={yarns} factories={factories} fixedFactoryId={user.factory_id ?? undefined}
        looms={looms} defaultLoomId={uuidParam(loom)} canUnload={canEdit(user)} />
    </div>
  );
}

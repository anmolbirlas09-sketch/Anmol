import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Notice, PageHeader } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { getBeamSummary } from '@/lib/data/beams';
import { listLoomStatus } from '@/lib/data/looms';
import { listFabricQualities, listFactories, listSpecifications, listYarnQualities } from '@/lib/data/masters';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { BeamCardForm } from '../../BeamCardForm';

export const metadata: Metadata = { title: L.card.edit };

export default async function EditBeamPage({ params }: PageProps<'/beams/[id]/edit'>) {
  const user = await requireUser();
  const { id } = await params;
  const db = await createClient();
  const beam = await getBeamSummary(db, id).catch(() => null);
  if (!beam) notFound();
  if (!canEdit(user)) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={L.card.editTitle(beam.beam_no)} back={`/beams/${id}`} />
        <Notice tone="warn">{L.card.editOnlySupervisor}</Notice>
      </div>
    );
  }
  const [qualities, factories, specs, yarns, looms] = await Promise.all([
    listFabricQualities(db, { activeOnly: true }), listFactories(db), listSpecifications(db),
    listYarnQualities(db, { activeOnly: true }), listLoomStatus(db, { factoryId: user.factory_id ?? undefined }),
  ]);
  // Quality / specification are fixed once production was recorded against them.
  const locked = beam.takeoff_count > 0 && beam.fabric_specification_id !== null;
  // keep the beam's own (possibly inactive) quality in the list
  const qs = qualities.some((q) => q.id === beam.fabric_quality_id) ? qualities
    : [...qualities, ...(await listFabricQualities(db)).filter((q) => q.id === beam.fabric_quality_id)];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={L.card.editTitle(beam.beam_no)} back={`/beams/${id}`} />
      <BeamCardForm beam={beam} locked={locked} qualities={qs} specs={specs} yarns={yarns} factories={factories}
        fixedFactoryId={user.factory_id ?? undefined} looms={looms} canUnload />
    </div>
  );
}

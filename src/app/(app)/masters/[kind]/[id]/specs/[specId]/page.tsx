import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { getFabricQuality, getSpecification, listYarnQualities } from '@/lib/data/masters';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { SpecForm } from '../SpecForm';

export default async function SpecificationPage({ params }: PageProps<'/masters/[kind]/[id]/specs/[specId]'>) {
  const user = await requireUser();
  const { kind, id, specId } = await params;
  if (kind !== 'fabric-qualities') notFound();
  if (!canEdit(user)) redirect(`/masters/${kind}`);
  const db = await createClient();
  const [quality, yarnQualities] = await Promise.all([getFabricQuality(db, id).catch(() => null), listYarnQualities(db, { activeOnly: true })]);
  if (!quality) notFound();
  const spec = specId === 'new' ? null : await getSpecification(db, specId).catch(() => null);
  if (specId !== 'new' && (!spec || spec.fabric_quality_id !== quality.id)) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={spec ? L.spec.edit : L.spec.add} back={`/masters/fabric-qualities/${quality.id}`} subtitle={`${L.spec.parent}: ${quality.name}`} />
      <SpecForm
        qualityId={quality.id}
        spec={spec}
        yarnQualities={yarnQualities}
        defaults={{ warp_yarn_quality_id: quality.warp_yarn_quality_id, weft_yarn_quality_id: quality.weft_yarn_quality_id }}
      />
    </div>
  );
}

import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { getFabricQuality, getSupplier, getYarnQuality, listYarnQualities } from '@/lib/data/masters';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { MASTER_KINDS, isMasterKind } from '../../config';
import { MasterForm } from './MasterForm';

const DEFAULTS = {
  'yarn-qualities': { reorder_level_kg: 0, active: true },
  'fabric-qualities': { warp_crimp_pct: 0, weft_wastage_pct: 0, active: true },
  suppliers: { active: true },
};

export default async function MasterEditPage({ params }: PageProps<'/masters/[kind]/[id]'>) {
  const user = await requireUser();
  const { kind, id } = await params;
  if (!isMasterKind(kind)) notFound();
  if (!canEdit(user)) redirect(`/masters/${kind}`);
  const db = await createClient();
  const isNew = id === 'new';

  let initial: Record<string, string | number | boolean | null> | null = DEFAULTS[kind];
  if (!isNew) {
    const row =
      kind === 'yarn-qualities' ? await getYarnQuality(db, id) : kind === 'fabric-qualities' ? await getFabricQuality(db, id) : await getSupplier(db, id);
    if (!row) notFound();
    initial = row as unknown as Record<string, string | number | boolean | null>;
  }
  const yarnQualities = kind === 'fabric-qualities' ? await listYarnQualities(db, { activeOnly: true }) : [];

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={`${MASTER_KINDS[kind].title}${isNew ? ` · ${L.masters.add}` : ''}`} back={`/masters/${kind}`} />
      <MasterForm kind={kind} id={isNew ? null : id} initial={initial} yarnQualities={yarnQualities} />
    </div>
  );
}

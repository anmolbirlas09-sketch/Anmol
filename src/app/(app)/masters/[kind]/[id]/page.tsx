import { notFound, redirect } from 'next/navigation';
import { SpecList } from '@/components/SpecList';
import { Card, LinkButton, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { getFabricQuality, getSupplier, getYarnQuality, listSpecifications, listYarnQualities } from '@/lib/data/masters';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { MASTER_KINDS, isMasterKind } from '../../config';
import { MasterForm } from './MasterForm';

const DEFAULTS = {
  'yarn-qualities': { reorder_level_kg: 0, active: true },
  'fabric-qualities': { warp_crimp_pct: 0, weft_wastage_pct: 0, active: true },
  suppliers: { active: true },
};

export default async function MasterEditPage({ params, searchParams }: PageProps<'/masters/[kind]/[id]'>) {
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
  const specs = kind === 'fabric-qualities' && !isNew ? await listSpecifications(db, { qualityId: id }) : [];
  const { saved, specSaved } = await searchParams;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={`${MASTER_KINDS[kind].title}${isNew ? ` · ${L.masters.add}` : ''}`} back={`/masters/${kind}`} />
      {saved && <div className="mb-4"><Notice tone="ok">{L.masters.saved}</Notice></div>}
      {kind === 'fabric-qualities' && !isNew && (
        <section className="mb-6" aria-label={L.spec.title}>
          {specSaved && <div className="mb-3"><Notice tone="ok">{L.spec.saved}</Notice></div>}
          <SectionTitle action={<LinkButton href={`/masters/${kind}/${id}/specs/new`} className="min-h-10 px-3 text-sm">+ {L.spec.add}</LinkButton>}>
            {L.spec.title}
          </SectionTitle>
          <Card className="p-0">
            <SpecList specs={specs} editHref={(s) => `/masters/${kind}/${id}/specs/${s.id}`} />
          </Card>
        </section>
      )}
      {kind === 'fabric-qualities' && !isNew && <SectionTitle>{L.spec.parent}</SectionTitle>}
      <MasterForm kind={kind} id={isNew ? null : id} initial={initial} yarnQualities={yarnQualities} />
    </div>
  );
}

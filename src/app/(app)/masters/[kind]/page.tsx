import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, EmptyState, LinkButton, Notice, PageHeader, inputClass } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { listFabricQualities, listSpecifications, listSuppliers, listYarnQualities } from '@/lib/data/masters';
import { SpecList } from '@/components/SpecList';
import { fmtKg } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { MASTER_KINDS, isMasterKind } from '../config';

export default async function MasterListPage({ params, searchParams }: PageProps<'/masters/[kind]'>) {
  const user = await requireUser();
  const { kind } = await params;
  const { saved, q: qRaw } = await searchParams;
  const q = typeof qRaw === 'string' ? qRaw.trim() : '';
  if (!isMasterKind(kind)) notFound();
  const db = await createClient();

  let rows: { id: string; title: string; detail: string; active: boolean }[];
  if (kind === 'yarn-qualities') {
    rows = (await listYarnQualities(db)).map((q) => ({
      id: q.id, title: q.name, active: q.active,
      detail: [q.denier && `${q.denier} D`, q.material, q.color, `${L.masters.reorderLevel}: ${fmtKg(q.reorder_level_kg)}`].filter(Boolean).join(' · '),
    }));
  } else if (kind === 'fabric-qualities') {
    return <FabricQualityList q={q} saved={Boolean(saved)} editable={canEdit(user)} />;
  } else {
    rows = (await listSuppliers(db)).map((s) => ({
      id: s.id, title: s.name, active: s.active, detail: [s.gstin, s.contact, s.phone].filter(Boolean).join(' · '),
    }));
  }

  const editable = canEdit(user);
  return (
    <>
      <PageHeader
        title={MASTER_KINDS[kind].title}
        back="/masters"
        action={editable ? <LinkButton href={`/masters/${kind}/new`}>+ {L.masters.add}</LinkButton> : undefined}
      />
      {saved && (
        <div className="mb-4">
          <Notice tone="ok">{L.masters.saved}</Notice>
        </div>
      )}
      {!editable && (
        <div className="mb-4">
          <Notice tone="neutral">{L.masters.ownerOrSupervisor}</Notice>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title={L.app.noResults} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((r) => {
            const body = (
              <>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    {r.title}
                    {!r.active && <Badge>{L.masters.inactive}</Badge>}
                  </div>
                  {r.detail && <div className="truncate text-sm text-muted">{r.detail}</div>}
                </div>
                {editable && <span aria-hidden className="text-muted">›</span>}
              </>
            );
            return (
              <li key={r.id}>
                {editable ? (
                  <Link href={`/masters/${kind}/${r.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-sunken">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Parent qualities, each with its specifications; search by quality name or Specification ID. */
async function FabricQualityList({ q, saved, editable }: { q: string; saved: boolean; editable: boolean }) {
  const db = await createClient();
  const [qualities, specs] = await Promise.all([listFabricQualities(db), listSpecifications(db)]);
  const term = q.toLowerCase();
  const groups = qualities
    .map((fq) => {
      const all = specs.filter((s) => s.fabric_quality_id === fq.id);
      const parentHit = !term || fq.name.toLowerCase().includes(term);
      const hits = parentHit ? all : all.filter((s) => s.spec_code.toLowerCase().includes(term));
      return { fq, specs: hits, show: parentHit || hits.length > 0 };
    })
    .filter((g) => g.show);

  return (
    <>
      <PageHeader
        title={L.masters.fabricQualities}
        back="/masters"
        action={editable ? <LinkButton href="/masters/fabric-qualities/new">+ {L.masters.add}</LinkButton> : undefined}
      />
      {saved && <div className="mb-4"><Notice tone="ok">{L.masters.saved}</Notice></div>}
      {!editable && <div className="mb-4"><Notice tone="neutral">{L.masters.ownerOrSupervisor}</Notice></div>}
      <form className="mb-4 flex gap-2" action="/masters/fabric-qualities">
        <input name="q" type="search" defaultValue={q} placeholder={L.spec.searchPlaceholder} aria-label={L.app.search} className={inputClass} />
        <button className="min-h-12 rounded-lg border border-line bg-surface px-4 font-semibold">{L.app.search}</button>
      </form>
      {groups.length === 0 ? (
        <EmptyState title={L.app.noResults} />
      ) : (
        <ul className="space-y-3">
          {groups.map(({ fq, specs: list }) => (
            <li key={fq.id} className="overflow-hidden rounded-xl border border-line bg-surface" data-quality={fq.name}>
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-bold">
                    {fq.name}
                    {!fq.active && <Badge>{L.masters.inactive}</Badge>}
                  </div>
                  <div className="text-xs text-muted">{L.spec.count(fq.spec_count)}</div>
                </div>
                {editable && (
                  <Link href={`/masters/fabric-qualities/${fq.id}`} className="shrink-0 text-sm font-semibold text-brand">
                    {L.app.edit} ›
                  </Link>
                )}
              </div>
              <SpecList specs={list} editHref={editable ? (s) => `/masters/fabric-qualities/${fq.id}/specs/${s.id}` : undefined} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

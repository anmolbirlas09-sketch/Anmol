import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { listFabricQualities, listSuppliers, listYarnQualities } from '@/lib/data/masters';
import { fmtKg } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { MASTER_KINDS, isMasterKind } from '../config';

export default async function MasterListPage({ params, searchParams }: PageProps<'/masters/[kind]'>) {
  const user = await requireUser();
  const { kind } = await params;
  const { saved } = await searchParams;
  if (!isMasterKind(kind)) notFound();
  const db = await createClient();

  let rows: { id: string; title: string; detail: string; active: boolean }[];
  if (kind === 'yarn-qualities') {
    rows = (await listYarnQualities(db)).map((q) => ({
      id: q.id, title: q.name, active: q.active,
      detail: [q.denier && `${q.denier} D`, q.material, q.color, `${L.masters.reorderLevel}: ${fmtKg(q.reorder_level_kg)}`].filter(Boolean).join(' · '),
    }));
  } else if (kind === 'fabric-qualities') {
    rows = (await listFabricQualities(db)).map((q) => ({
      id: q.id, title: q.name, active: q.active,
      detail: `${L.masters.warpYarn}: ${q.warp_yarn_quality_name ?? L.app.none} · ${L.masters.weftYarn}: ${q.weft_yarn_quality_name ?? L.app.none}`,
    }));
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

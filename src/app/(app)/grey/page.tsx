import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveRefresh } from '@/components/LiveRefresh';
import { EmptyState, LinkButton, PageHeader, Segmented, Stat } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { greyStock, groupGreyByQuality } from '@/lib/data/grey';
import { listFactories } from '@/lib/data/masters';
import { fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import { factoryParam } from '@/lib/params';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: L.grey.title };

export default async function GreyPage({ searchParams }: PageProps<'/grey'>) {
  const user = await requireUser();
  const { factory } = await searchParams;
  const db = await createClient();
  const factories = await listFactories(db);
  const factoryId = factoryParam(factory, factories);
  const rows = await greyStock(db, { factoryId });
  const groups = groupGreyByQuality(rows);
  const total = groups.reduce((t, g) => ({ m: t.m + g.stock_m, kg: t.kg + g.stock_kg }), { m: 0, kg: 0 });

  return (
    <>
      <PageHeader title={L.grey.title} subtitle={<LiveRefresh />} action={<LinkButton href="/dispatch">{L.dispatch.short}</LinkButton>} />
      <div className="mb-4">
        <Segmented
          label={L.beam.factory}
          items={[
            { href: '/grey', label: L.app.all, active: !factoryId },
            ...factories.map((f) => ({ href: `/grey?factory=${f.id}`, label: f.code, active: factoryId === f.id })),
          ]}
        />
      </div>
      {canEdit(user) && (
        <p className="-mt-2 mb-3 text-right">
          <Link href="/grey/adjust" className="text-sm font-semibold text-brand">{L.adjust.greyTitle} ›</Link>
        </p>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3" data-testid="grey-total">
        <Stat label={`${L.grey.stock} (m)`} value={fmtM(total.m)} unit="m" />
        <Stat label={`${L.grey.stock} (kg)`} value={fmtKg(total.kg)} unit="kg" />
      </div>

      {groups.length === 0 ? (
        <EmptyState title={L.grey.none} hint={L.grey.noneHint} />
      ) : (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{L.grey.byQuality}</h2>
          <ul className="grid gap-2 md:grid-cols-2" aria-label={L.grey.byQuality}>
            {groups.map((g) => (
              <li key={g.fabric_quality_id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold">{g.fabric_quality_name}</h3>
                  <div className="tnum shrink-0 text-right">
                    <div className="text-lg font-bold">{fmtM(g.stock_m)} m</div>
                    <div className="text-sm font-semibold">{fmtKg(g.stock_kg)} kg</div>
                  </div>
                </div>
                <dl className="tnum mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted">{L.grey.produced}</dt>
                    <dd>{fmtM(g.produced_m)} m · {fmtKg(g.produced_kg)} kg</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{L.grey.dispatched}</dt>
                    <dd>{fmtM(g.dispatched_m)} m · {fmtKg(g.dispatched_kg)} kg</dd>
                  </div>
                </dl>
                {g.unweighed_count > 0 && <p className="mt-1 text-xs text-muted">{L.grey.unweighed(g.unweighed_count)}</p>}
                {!factoryId && (
                  <ul className="tnum mt-2 space-y-0.5 border-t border-line pt-2 text-xs text-muted">
                    {g.factories.map((f) => (
                      <li key={f.factory_id} className="flex justify-between">
                        <span>{f.factory_code}</span>
                        <span>{fmtM(f.stock_m)} m · {fmtKg(f.stock_kg)} kg</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Each specification's own stock (never merged) */}
                <details className="mt-2 border-t border-line pt-2" open={g.specs.length > 1 || undefined} data-testid="grey-specs">
                  <summary className="cursor-pointer text-xs font-semibold text-brand">{L.spec.count(g.specs.length)}</summary>
                  <div className="mt-1 space-y-1.5">
                    {g.specs.map((sp) => (
                      <div key={sp.fabric_specification_id} className="tnum rounded-md bg-sunken px-2 py-1.5 text-xs" data-spec={sp.spec_code}>
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold">{sp.spec_code}</span>
                          <span className="font-semibold">{fmtM(sp.stock_m)} m · {fmtKg(sp.stock_kg)} kg</span>
                        </div>
                        <div className="text-muted">
                          {L.spec.summary(sp.reed === null ? L.spec.notSet : String(sp.reed), sp.ends_per_inch === null ? L.spec.notSet : String(sp.ends_per_inch))}
                          {!factoryId && sp.factories.length > 1 && ` · ${sp.factories.map((f) => `${f.factory_code} ${fmtM(f.stock_m)} m`).join(' · ')}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

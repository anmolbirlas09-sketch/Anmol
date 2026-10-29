import type { Metadata } from 'next';
import { EmptyState, PageHeader, Segmented, Stat } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { greyStock, groupGreyByQuality } from '@/lib/data/grey';
import { listFactories } from '@/lib/data/masters';
import { fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: L.grey.title };

export default async function GreyPage({ searchParams }: PageProps<'/grey'>) {
  await requireUser();
  const { factory } = await searchParams;
  const factoryId = typeof factory === 'string' ? factory : undefined;
  const db = await createClient();
  const [factories, rows] = await Promise.all([listFactories(db), greyStock(db, { factoryId })]);
  const groups = groupGreyByQuality(rows);
  const total = groups.reduce((t, g) => ({ m: t.m + g.stock_m, kg: t.kg + g.stock_kg }), { m: 0, kg: 0 });

  return (
    <>
      <PageHeader title={L.grey.title} subtitle={L.grey.dispatchSoon} />
      <div className="mb-4">
        <Segmented
          label={L.beam.factory}
          items={[
            { href: '/grey', label: L.app.all, active: !factoryId },
            ...factories.map((f) => ({ href: `/grey?factory=${f.id}`, label: f.code, active: factoryId === f.id })),
          ]}
        />
      </div>
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
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

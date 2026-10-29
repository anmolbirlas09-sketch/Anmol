import type { Metadata } from 'next';
import { LiveRefresh } from '@/components/LiveRefresh';
import Link from 'next/link';
import { Badge, EmptyState, LinkButton, Notice, PageHeader, Segmented, inputClass } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { listFactories } from '@/lib/data/masters';
import { listLotBalances, yarnStockByQuality } from '@/lib/data/yarn';
import { fmtDate, fmtKg } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: L.yarn.title };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function YarnPage({ searchParams }: PageProps<'/yarn'>) {
  await requireUser();
  const sp = await searchParams;
  const q = str(sp.q);
  const factory = str(sp.factory);
  const quality = str(sp.quality);
  const all = str(sp.all) === '1';
  const saved = str(sp.saved);

  const db = await createClient();
  const [factories, stock, lots] = await Promise.all([
    listFactories(db),
    yarnStockByQuality(db),
    listLotBalances(db, { q, factoryId: factory, qualityId: quality, includeEmpty: all }),
  ]);

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, factory, quality, all: all ? '1' : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/yarn?${s}` : '/yarn';
  };

  return (
    <>
      <PageHeader subtitle={<LiveRefresh />} title={L.yarn.title} action={<LinkButton href="/yarn/new">+ {L.yarn.newLotShort}</LinkButton>} />
      {saved && (
        <div className="mb-4">
          <Notice tone="ok">{L.yarn.saved(saved)}</Notice>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{L.yarn.stockByQuality}</h2>
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
        {stock.filter((s) => s.balance_kg > 0 || s.is_low_stock).map((s) => (
          <Link
            key={s.yarn_quality_id}
            href={href({ quality: quality === s.yarn_quality_id ? undefined : s.yarn_quality_id })}
            aria-current={quality === s.yarn_quality_id ? 'true' : undefined}
            className="min-w-44 shrink-0 rounded-xl border border-line bg-surface p-3 aria-[current=true]:border-brand aria-[current=true]:ring-2 aria-[current=true]:ring-brand/30"
          >
            <div className="truncate text-sm font-semibold">{s.yarn_quality_name}</div>
            <div className="tnum mt-1 text-lg font-bold">
              {fmtKg(s.balance_kg)} <span className="text-sm font-medium text-muted">kg</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted">
              {L.yarn.lotCount(s.open_lot_count)}
              {s.is_low_stock && <Badge tone="warn">{L.yarn.lowStock}</Badge>}
            </div>
          </Link>
        ))}
      </div>

      <div className="mb-3 space-y-2">
        <Segmented
          label={L.yarn.factory}
          items={[
            { href: href({ factory: undefined }), label: L.app.all, active: !factory },
            ...factories.map((f) => ({ href: href({ factory: f.id }), label: f.code, active: factory === f.id })),
          ]}
        />
        <form className="flex gap-2" action="/yarn">
          {factory && <input type="hidden" name="factory" value={factory} />}
          {quality && <input type="hidden" name="quality" value={quality} />}
          {all && <input type="hidden" name="all" value="1" />}
          <input name="q" type="search" defaultValue={q} placeholder={L.yarn.searchPlaceholder} aria-label={L.app.search} className={inputClass} />
          <button className="min-h-12 rounded-lg border border-line bg-surface px-4 font-semibold">{L.app.search}</button>
        </form>
        <Link href={href({ all: all ? undefined : '1' })} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-brand">
          <span aria-hidden>{all ? '☑' : '☐'}</span> {L.yarn.showEmpty}
        </Link>
      </div>

      {lots.length === 0 ? (
        <EmptyState title={q || quality || factory ? L.app.noResults : L.yarn.noLots} hint={q ? undefined : L.yarn.noLotsHint} />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {lots.map((l) => {
            const usedPct = l.kgs_received > 0 ? Math.min(100, Math.max(0, (1 - l.balance_kg / l.kgs_received) * 100)) : 0;
            return (
              <li key={l.yarn_lot_id}>
                <Link href={`/yarn/${l.yarn_lot_id}`} className="block rounded-xl border border-line bg-surface p-3 hover:border-brand">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold">{l.lot_no}</div>
                      <div className="truncate text-sm">{l.yarn_quality_name}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        {fmtDate(l.inward_date)} · {l.factory_code}
                        {l.supplier_name ? ` · ${l.supplier_name}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`tnum text-lg font-bold ${l.balance_kg <= 0 ? 'text-muted' : ''}`}>{fmtKg(l.balance_kg)}</div>
                      <div className="tnum text-xs text-muted">
                        of {fmtKg(l.kgs_received)} kg
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                    <div className="h-full rounded-full bg-brand" style={{ width: `${100 - usedPct}%` }} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

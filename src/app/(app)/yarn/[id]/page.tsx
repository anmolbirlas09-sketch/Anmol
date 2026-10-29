import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, PageHeader, SectionTitle, Stat } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getLotBalance, getLotLedger } from '@/lib/data/yarn';
import { fmtDate, fmtKg } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: L.yarn.title };

export default async function LotPage({ params }: PageProps<'/yarn/[id]'>) {
  await requireUser();
  const { id } = await params;
  const db = await createClient();
  const lot = await getLotBalance(db, id).catch(() => null);
  if (!lot) notFound();
  const ledger = await getLotLedger(db, id);

  let running = 0;
  const rows = ledger.map((r) => ({ ...r, running: (running += Number(r.kgs)) }));

  const info: [string, string][] = [
    [L.yarn.quality, lot.yarn_quality_name],
    [L.yarn.factory, lot.factory_code],
    [L.yarn.inwardDate, fmtDate(lot.inward_date)],
    [L.yarn.supplier, lot.supplier_name ?? L.app.none],
    [L.yarn.challan, lot.challan_no ?? L.app.none],
  ];

  return (
    <>
      <PageHeader title={L.yarn.lotTitle(lot.lot_no)} back="/yarn" subtitle={lot.yarn_quality_name} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={L.yarn.balance} value={fmtKg(lot.balance_kg)} unit="kg" />
        <Stat label={L.yarn.kgsReceived} value={fmtKg(lot.kgs_received)} unit="kg" />
        <Stat label={L.yarn.warpUsed} value={fmtKg(lot.warp_consumed_kg)} unit="kg" />
        <Stat label={L.yarn.weftUsed} value={fmtKg(lot.weft_consumed_kg)} unit="kg" />
      </div>

      <Card className="mt-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {info.map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <SectionTitle>{L.yarn.ledger}</SectionTitle>
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={`${r.movement_type}-${r.ref_id}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="font-semibold">
                  {L.yarn.movement[r.movement_type] ?? r.movement_type}
                  {r.beam_id && (
                    <>
                      {' · '}
                      <Link href={`/beams/${r.beam_id}`} className="text-brand">
                        {r.beam_no}
                      </Link>
                    </>
                  )}
                </div>
                <div className="truncate text-xs text-muted">
                  {fmtDate(r.entry_date)}
                  {r.reference ? ` · ${r.reference}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`tnum font-bold ${r.kgs < 0 ? 'text-bad' : 'text-ok'}`}>
                  {r.kgs > 0 ? '+' : ''}
                  {fmtKg(r.kgs)}
                </div>
                <div className="tnum text-xs text-muted">{fmtKg(r.running)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

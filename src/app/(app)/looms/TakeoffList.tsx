import Link from 'next/link';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Card } from '@/components/ui';
import { fmtDate, fmtKg, fmtM, fmtTime } from '@/lib/format';
import { L } from '@/lib/labels';
import type { Takeoff } from '@/lib/types';
import { deleteTakeoffAction } from './actions';

export function TakeoffList({ rows, canDelete, returnTo, show = 'both' }: { rows: Takeoff[]; canDelete: boolean; returnTo: string; show?: 'beam' | 'loom' | 'both' }) {
  if (!rows.length) return <p className="text-sm text-muted">{L.takeoff.none}</p>;
  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {rows.map((t) => (
          <li key={t.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">
                  {show !== 'beam' && <Link href={`/looms/${t.loom_id}`} className="text-brand">{t.machine_no}</Link>}
                  {show === 'both' && ' · '}
                  {show !== 'loom' && <Link href={`/beams/${t.beam_id}`} className="text-brand">{t.beam_no}</Link>}
                  <span className="font-normal"> · {t.fabric_quality_name ?? L.beam.noQuality}{t.spec_code ? ` · ${t.spec_code}` : ''}</span>
                </div>
                <div className="truncate text-xs text-muted">
                  {fmtDate(t.entry_date)}
                  {t.production_time ? <> · <b data-testid="production-time">{fmtTime(t.production_time)}</b></> : ''}
                  {t.shift ? ` · ${L.takeoff.shiftShort[t.shift] ?? t.shift}` : ''}
                  {t.roll_count ? ` · ${t.roll_count} ${L.production.rollsTitle.toLowerCase()}` : t.roll_no ? ` · ${t.roll_no}` : ''}
                  {t.created_by_name ? ` · ${t.created_by_name}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tnum font-semibold">{t.meters !== null ? `${fmtM(t.meters)} m` : L.app.none}</span>
                {canDelete && (
                  <form action={deleteTakeoffAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="return" value={returnTo} />
                    <ConfirmButton className="min-h-10 rounded-md px-2 text-sm font-semibold text-bad">{L.app.delete}</ConfirmButton>
                  </form>
                )}
              </div>
            </div>
            {t.counter_reading !== null && (
              <div className="tnum mt-1 text-xs" data-testid="counter-row">
                {L.reports.col.counter} <b>{fmtM(t.counter_reading)}</b>
                {t.previous_reading !== null && <> · {L.reports.col.previous.toLowerCase()} {fmtM(t.previous_reading)}</>}
                {t.counter_reset && <> · {L.production.counterReset.split(' (')[0]}</>}
                {t.meters_source === 'counter' && <> · {L.production.sourceCounter}</>}
              </div>
            )}
            <div className="tnum mt-1 text-xs text-muted" data-testid="production-row">
              {L.production.net} {fmtM(t.net_meters)} m · {L.production.wasted} {fmtM(t.wasted_meters)} m {t.wastage_pct !== null ? `(${t.wastage_pct.toFixed(2)}%)` : ''}
              {(t.kgs !== null || t.estimated_kg !== null) && (
                <> · {t.kgs !== null ? `${fmtKg(t.kgs)} kg ${L.production.weighed}` : `≈${fmtKg(t.estimated_kg)} kg ${L.production.estimatedTag}`}</>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

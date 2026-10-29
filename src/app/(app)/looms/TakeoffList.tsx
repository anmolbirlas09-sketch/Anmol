import Link from 'next/link';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Card } from '@/components/ui';
import { fmtDate, fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import type { Takeoff } from '@/lib/types';
import { deleteTakeoffAction } from './actions';

export function TakeoffList({ rows, canDelete, returnTo, show = 'both' }: { rows: Takeoff[]; canDelete: boolean; returnTo: string; show?: 'beam' | 'loom' | 'both' }) {
  if (!rows.length) return <p className="text-sm text-muted">{L.takeoff.none}</p>;
  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="font-semibold">
                {show !== 'beam' && <Link href={`/looms/${t.loom_id}`} className="text-brand">{t.machine_no}</Link>}
                {show === 'both' && ' · '}
                {show !== 'loom' && <Link href={`/beams/${t.beam_id}`} className="text-brand">{t.beam_no}</Link>}
                <span className="font-normal"> · {t.fabric_quality_name}</span>
              </div>
              <div className="truncate text-xs text-muted">
                {fmtDate(t.entry_date)}
                {t.shift ? ` · ${L.takeoff.shifts[t.shift] ?? t.shift}` : ''}
                {t.roll_no ? ` · ${t.roll_no}` : ''}
                {t.created_by_name ? ` · ${t.created_by_name}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="tnum text-right">
                <div className="font-semibold">{fmtM(t.meters)} m</div>
                <div className="text-xs text-muted">{fmtKg(t.kgs)} kg</div>
              </div>
              {canDelete && (
                <form action={deleteTakeoffAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="return" value={returnTo} />
                  <ConfirmButton className="min-h-10 rounded-md px-2 text-sm font-semibold text-bad">{L.app.delete}</ConfirmButton>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

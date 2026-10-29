import Link from 'next/link';
import { cx } from '@/components/ui';
import { fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import type { LoomStatus, LoomStatusRow } from '@/lib/types';

const tileTone: Record<LoomStatus, string> = {
  running: 'border-ok/40 bg-ok-soft',
  idle: 'border-line bg-surface',
  maintenance: 'border-warn/50 bg-warn-soft',
};
const dotTone: Record<LoomStatus, string> = { running: 'bg-ok', idle: 'bg-muted/40', maintenance: 'bg-warn' };

/** One tile per loom, coloured by status; tap for the loom page. */
export function LoomGrid({ looms }: { looms: LoomStatusRow[] }) {
  const byFactory = new Map<string, LoomStatusRow[]>();
  for (const l of looms) byFactory.set(l.factory_code, [...(byFactory.get(l.factory_code) ?? []), l]);

  return (
    <div className="space-y-5">
      {[...byFactory.entries()].map(([code, list]) => {
        const running = list.filter((l) => l.status === 'running').length;
        return (
          <section key={code} aria-label={code}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-bold">{code}</h2>
              <span className="text-sm text-muted">{L.loom.running(running, list.length)}</span>
            </div>
            <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-9">
              {list.map((l) => (
                <li key={l.loom_id}>
                  <Link
                    href={`/looms/${l.loom_id}`}
                    data-status={l.status}
                    aria-label={`${l.machine_no}, ${L.loom.statuses[l.status]}${l.beam_no ? `, ${l.beam_no}` : ''}`}
                    className={cx('flex min-h-16 flex-col justify-between rounded-lg border p-1.5 text-xs', tileTone[l.status])}
                  >
                    <span className="flex items-center justify-between gap-1 font-bold">
                      {l.machine_no.replace(/^L\d+-/, '')}
                      <span aria-hidden className={cx('size-2 rounded-full', dotTone[l.status])} />
                    </span>
                    {l.beam_no ? (
                      <span className="truncate leading-tight">
                        <span className="block truncate font-semibold">{l.beam_no}</span>
                        <span className="tnum block truncate text-muted">{fmtM(l.meters_on_beam)} m</span>
                      </span>
                    ) : (
                      <span className="text-muted">{L.loom.statuses[l.status]}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

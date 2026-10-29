import { cx } from '@/components/ui';
import { fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import type { LoomStatus, LoomStatusRow } from '@/lib/types';

// Shared by the /looms grid (links) and the dashboard grid (opens a sheet).

export const tileClass: Record<LoomStatus, string> = {
  running: 'border-ok/40 bg-ok-soft',
  idle: 'border-line bg-surface',
  maintenance: 'border-warn/50 bg-warn-soft',
};
const dotTone: Record<LoomStatus, string> = { running: 'bg-ok', idle: 'bg-muted/40', maintenance: 'bg-warn' };

export const tileBase = 'flex min-h-16 w-full flex-col justify-between rounded-lg border p-1.5 text-left text-xs';

export const tileLabel = (l: LoomStatusRow) => `${l.machine_no}, ${L.loom.statuses[l.status]}${l.beam_no ? `, ${l.beam_no}` : ''}`;

export function LoomTileBody({ loom: l }: { loom: LoomStatusRow }) {
  return (
    <>
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
    </>
  );
}

export function groupByFactory(looms: LoomStatusRow[]): [string, LoomStatusRow[]][] {
  const by = new Map<string, LoomStatusRow[]>();
  for (const l of looms) by.set(l.factory_code, [...(by.get(l.factory_code) ?? []), l]);
  return [...by.entries()];
}

export function FactoryHeading({ code, list }: { code: string; list: LoomStatusRow[] }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="font-bold">{code}</h2>
      <span className="text-sm text-muted">{L.loom.running(list.filter((l) => l.status === 'running').length, list.length)}</span>
    </div>
  );
}

export const gridClass = 'grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-9';

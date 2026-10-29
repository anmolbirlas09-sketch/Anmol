'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Badge, buttonClass, cx, type Tone } from '@/components/ui';
import { fmtDateTime, fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import type { LoomStatus, LoomStatusRow } from '@/lib/types';
import { FactoryHeading, LoomTileBody, gridClass, groupByFactory, tileBase, tileClass, tileLabel } from './looms/LoomTile';

const tone: Record<LoomStatus, Tone> = { running: 'ok', idle: 'neutral', maintenance: 'warn' };

/** Dashboard loom grid: tap a tile for a sheet with the loom's beam and numbers. */
export function LoomGridSheet({ looms, userFactoryId }: { looms: LoomStatusRow[]; /** null = may work in every factory */ userFactoryId: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // Look the loom up in the latest props so live refreshes update an open sheet.
  const loom = looms.find((l) => l.loom_id === openId) ?? null;
  const mayWork = Boolean(loom) && (userFactoryId === null || loom?.factory_id === userFactoryId);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (openId && !d.open) d.showModal();
    if (!openId && d.open) d.close();
  }, [openId]);

  return (
    <>
      <div className="space-y-5">
        {groupByFactory(looms).map(([code, list]) => (
          <section key={code} aria-label={code}>
            <FactoryHeading code={code} list={list} />
            <ul className={gridClass}>
              {list.map((l) => (
                <li key={l.loom_id}>
                  <button
                    type="button"
                    data-status={l.status}
                    aria-label={tileLabel(l)}
                    aria-haspopup="dialog"
                    onClick={() => setOpenId(l.loom_id)}
                    className={cx(tileBase, tileClass[l.status])}
                  >
                    <LoomTileBody loom={l} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="loom-sheet-title"
        onClose={() => setOpenId(null)}
        onClick={(e) => e.target === dialog.current && setOpenId(null)} // tap outside
        className="m-0 mt-auto w-full max-w-none rounded-t-2xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40 sm:m-auto sm:max-w-md sm:rounded-2xl"
      >
        {loom && (
          <div className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 id="loom-sheet-title" className="text-xl font-bold">{loom.machine_no}</h2>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                  <Badge tone={tone[loom.status]}>{L.loom.statuses[loom.status]}</Badge> {loom.factory_code}
                </div>
              </div>
              <button type="button" onClick={() => setOpenId(null)} className="min-h-10 rounded-md px-3 text-sm font-semibold text-brand">
                {L.dashboard.close}
              </button>
            </div>

            {loom.beam_id ? (
              <dl className="tnum grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2">
                  <dt className="text-muted">{L.loom.currentBeam}</dt>
                  <dd className="text-lg font-bold">
                    <Link href={`/beams/${loom.beam_id}`} className="text-brand">{loom.beam_no}</Link>
                    <span className="font-normal"> · {loom.fabric_quality_name}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{L.loom.producedSoFar}</dt>
                  <dd className="font-semibold">{fmtM(loom.meters_on_beam)} m · {fmtKg(loom.kgs_on_beam)} kg</dd>
                </div>
                <div>
                  <dt className="text-muted">{L.beam.expectedFabric}</dt>
                  <dd className="font-semibold">{fmtM(loom.expected_fabric_length_m)} m</dd>
                </div>
                <div>
                  <dt className="text-muted">{L.beam.warp}</dt>
                  <dd className="font-semibold">{fmtKg(loom.warp_kg)} kg</dd>
                </div>
                <div>
                  <dt className="text-muted">{L.beam.weft}</dt>
                  <dd className="font-semibold">{fmtKg(loom.weft_kg)} kg</dd>
                </div>
                <div className="col-span-2 text-xs text-muted">{L.loom.loadedAt} {fmtDateTime(loom.loaded_at)}</div>
              </dl>
            ) : (
              <p className="text-muted">{L.loom.noBeam}</p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              {mayWork && loom.status === 'running' && <Link href={`/takeoff?loom=${loom.loom_id}`} className={buttonClass.primary}>{L.takeoff.short}</Link>}
              {mayWork && loom.status === 'idle' && <Link href={`/looms/load?loom=${loom.loom_id}`} className={buttonClass.primary}>{L.loom.loadShort}</Link>}
              <Link href={`/looms/${loom.loom_id}`} className={cx(buttonClass.secondary, (!mayWork || loom.status === 'maintenance') && 'col-span-2')}>
                {L.dashboard.openLoom}
              </Link>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

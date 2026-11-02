import type { Metadata } from 'next';
import { LiveRefresh } from '@/components/LiveRefresh';
import Link from 'next/link';
import { EmptyState, LinkButton, PageHeader, Segmented, inputClass } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { listBeams } from '@/lib/data/beams';
import { listLoomStatus } from '@/lib/data/looms';
import { listFabricQualities } from '@/lib/data/masters';
import { uuidParam } from '@/lib/params';
import { fmtDate, fmtKg } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import type { BeamStatus } from '@/lib/types';
import { BeamStatusBadge } from './BeamStatusBadge';

export const metadata: Metadata = { title: L.beam.title };

const STATUSES: BeamStatus[] = ['prepared', 'on_loom', 'finished'];

export default async function BeamsPage({ searchParams }: PageProps<'/beams'>) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const loomId = uuidParam(sp.loom);
  const qualityId = uuidParam(sp.quality);
  const db = await createClient();
  const [beams, looms, qualities] = await Promise.all([
    listBeams(db, { status, q, loomId, qualityId }),
    listLoomStatus(db, { factoryId: user.factory_id ?? undefined }),
    listFabricQualities(db),
  ]);

  const href = (s?: BeamStatus) => {
    const p = new URLSearchParams();
    if (s) p.set('status', s);
    if (q) p.set('q', q);
    if (loomId) p.set('loom', loomId);
    if (qualityId) p.set('quality', qualityId);
    return p.size ? `/beams?${p}` : '/beams';
  };

  return (
    <>
      <PageHeader subtitle={<LiveRefresh />} title={L.beam.title} action={<LinkButton href="/beams/new">+ {L.card.newTitle}</LinkButton>} />
      <div className="mb-3 space-y-2">
        <Segmented
          label={L.beam.status}
          items={[
            { href: href(), label: L.app.all, active: !status },
            ...STATUSES.map((s) => ({ href: href(s), label: L.beam.statuses[s], active: status === s })),
          ]}
        />
        <form className="grid grid-cols-2 gap-2 sm:grid-cols-4" action="/beams">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" type="search" defaultValue={q} placeholder={L.beam.searchPlaceholder} aria-label={L.app.search} className={`${inputClass} col-span-2`} />
          <select name="quality" defaultValue={qualityId ?? ''} aria-label={L.card.filterQuality} className={inputClass}>
            <option value="">{L.card.filterQuality}: {L.card.any}</option>
            {qualities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select name="loom" defaultValue={loomId ?? ''} aria-label={L.card.filterLoom} className={inputClass}>
            <option value="">{L.card.filterLoom}: {L.card.any}</option>
            {looms.map((l) => <option key={l.loom_id} value={l.loom_id}>{l.machine_no}</option>)}
          </select>
          <button className="col-span-2 min-h-12 rounded-lg border border-line bg-surface px-4 font-semibold sm:col-span-4">{L.app.search}</button>
        </form>
      </div>

      {beams.length === 0 ? (
        <EmptyState title={q || status || loomId || qualityId ? L.app.noResults : L.beam.noBeams} hint={L.beam.noBeamsHint} />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {beams.map((b) => (
            <li key={b.beam_id}>
              <Link href={`/beams/${b.beam_id}`} className="block rounded-xl border border-line bg-surface p-3 hover:border-brand">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold" data-beam={b.beam_no}>{b.beam_no}</span>
                      <BeamStatusBadge status={b.status} unloaded={b.status === 'prepared' && b.takeoff_count > 0} />
                    </div>
                    <div className="truncate text-sm">{b.fabric_quality_name ?? L.beam.noQuality}{b.spec_code ? ` · ${b.spec_code}` : ''}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {[fmtDate(b.register_date), b.factory_code, b.status === 'on_loom' ? b.machine_no : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="tnum shrink-0 text-right text-sm">
                    <div>
                      <span className="text-muted">{L.beam.warp} </span>
                      <span className={b.warp_variance_flag ? 'font-bold text-bad' : 'font-semibold'}>{fmtKg(b.warp_kg)}</span>
                    </div>
                    <div>
                      <span className="text-muted">{L.beam.weft} </span>
                      <span className={b.weft_variance_flag ? 'font-bold text-bad' : 'font-semibold'}>{fmtKg(b.weft_kg)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

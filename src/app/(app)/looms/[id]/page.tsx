import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmButton } from '@/components/ConfirmButton';
import { SpecDetails } from '@/components/SpecPicker';
import { Badge, Card, LinkButton, Notice, PageHeader, SectionTitle, Stat, buttonClass, type Tone } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { listBeamEvents } from '@/lib/data/beams';
import { getLoomStatus, listPreparedBeams, listTakeoffs } from '@/lib/data/looms';
import { listFabricQualities } from '@/lib/data/masters';
import { currentShift, fmtDate, fmtDateTime, fmtKg, fmtM, nowTimeIST, todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import type { LoomStatus } from '@/lib/types';
import { finishBeamAction, unloadBeamAction } from '../actions';
import { LoadBeamForm } from '../LoadBeamForm';
import { ProductionForm } from '../ProductionForm';
import { TakeoffList } from '../TakeoffList';

export const metadata: Metadata = { title: L.loom.loom };

const tone: Record<LoomStatus, Tone> = { running: 'ok', idle: 'neutral', maintenance: 'warn' };

export default async function LoomPage({ params, searchParams }: PageProps<'/looms/[id]'>) {
  const user = await requireUser();
  const { id } = await params;
  const { loaded, error, finished } = await searchParams;
  const db = await createClient();
  const loom = await getLoomStatus(db, id).catch(() => null);
  if (!loom) notFound();
  const mayWork = !user.factory_id || user.factory_id === loom.factory_id;
  const [takeoffs, prepared, qualities, events] = await Promise.all([
    listTakeoffs(db, { loomId: id, limit: 30 }),
    loom.status !== 'maintenance' && mayWork ? listPreparedBeams(db) : Promise.resolve([]),
    loom.beam_id && mayWork ? listFabricQualities(db) : Promise.resolve([]),
    listBeamEvents(db, { loomId: id, limit: 20 }),
  ]);
  const here = `/looms/${id}`;

  return (
    <>
      <PageHeader
        title={loom.machine_no}
        back="/looms"
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge tone={tone[loom.status]}>{L.loom.statuses[loom.status]}</Badge> {loom.factory_code}
            {loom.assigned_spec_code && <span>· {L.spec.loomAssigned}: <b>{loom.assigned_spec_code}</b></span>}
          </span>
        }
      />
      {typeof error === 'string' && (
        <div className="mb-4"><Notice tone="bad">{error}</Notice></div>
      )}
      {typeof finished === 'string' && !loom.beam_id && (
        <div className="mb-4"><Notice tone="ok">{L.takeoff.savedFinished(finished)}</Notice></div>
      )}
      {loaded && loom.beam_no && (
        <div className="mb-4"><Notice tone="ok">{L.loom.loaded(loom.beam_no, loom.machine_no)}</Notice></div>
      )}

      {loom.beam_id ? (
        <>
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">{L.loom.currentBeam}</div>
                <Link href={`/beams/${loom.beam_id}`} className="text-xl font-bold text-brand" data-testid="loom-beam">{loom.beam_no}</Link>
                <div className="text-sm">{loom.fabric_quality_name ?? L.beam.noQuality} · <b data-testid="loom-spec">{loom.spec_code ?? L.beam.noSpec}</b></div>
                <div className="text-xs text-muted">
                  {L.loom.loadedAt} {fmtDateTime(loom.loaded_at)}
                  {loom.expected_finish_date && ` · ${L.card.finishExpected} ${fmtDate(loom.expected_finish_date)}`}
                </div>
              </div>
            </div>
            <div className="mt-3"><SpecDetails spec={{ spec_code: loom.spec_code ?? '', reed: loom.reed, ends_per_inch: loom.ends_per_inch, warp_yarn_quality_name: loom.warp_yarn_quality_name, weft_yarn_quality_name: loom.weft_yarn_quality_name }} /></div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={L.loom.producedSoFar} value={fmtM(loom.meters_on_beam)} unit="m" />
              <Stat label={L.production.net} value={fmtM(loom.net_on_beam)} unit="m" sub={`${L.production.wasted} ${fmtM(loom.wasted_on_beam)} m`} />
              <Stat label={L.beam.warp} value={fmtKg(loom.warp_kg)} unit="kg" />
              <Stat label={L.beam.weft} value={fmtKg(loom.weft_kg)} unit="kg" />
            </div>
          </Card>

          {mayWork && (
            <>
              <SectionTitle>{L.takeoff.title}</SectionTitle>
              <Card>
                <ProductionForm looms={[loom]} qualities={qualities} fixedLoomId={loom.loom_id} today={todayIST()} shiftNow={currentShift()} nowTime={nowTimeIST()} returnTo={here} />
              </Card>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <form action={finishBeamAction}>
                  <input type="hidden" name="beam_id" value={loom.beam_id} />
                  <input type="hidden" name="return" value={here} />
                  <ConfirmButton message={L.loom.finishConfirm(loom.beam_no ?? '')} className={`${buttonClass.secondary} w-full`}>
                    {L.loom.finish}
                  </ConfirmButton>
                </form>
                {canEdit(user) && <form action={unloadBeamAction}>
                    <input type="hidden" name="beam_id" value={loom.beam_id} />
                    <input type="hidden" name="return" value={here} />
                    <ConfirmButton message={L.loom.unloadConfirm} className={`${buttonClass.danger} w-full`}>
                      {L.loom.unload}
                    </ConfirmButton>
                  </form>}
              </div>
              <SectionTitle>{L.card.replaceTitle}</SectionTitle>
              <div className="grid gap-2 sm:grid-cols-2">
                <LinkButton href={`/beams/new?loom=${loom.loom_id}`} variant="secondary">{L.card.newTitle}</LinkButton>
                {prepared.length > 0 && <LinkButton href={`/looms/load?loom=${loom.loom_id}`} variant="secondary">{L.card.loadExisting}</LinkButton>}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-muted">{L.loom.noBeam}</p>
          {mayWork && loom.status === 'idle' && (
            <>
              <LinkButton href={`/beams/new?loom=${loom.loom_id}`} className="mb-3 w-full">{L.card.newTitle}</LinkButton>
              {prepared.length > 0 && (
                <Card>
                  <h2 className="mb-3 font-semibold">{L.card.loadExisting}</h2>
                  <LoadBeamForm beams={prepared} looms={[]} fixedLoom={loom} canUnload={canEdit(user)} />
                </Card>
              )}
            </>
          )}
        </>
      )}

      <SectionTitle>{L.takeoff.recent}</SectionTitle>
      <TakeoffList rows={takeoffs} canDelete={canEdit(user)} returnTo={here} show="beam" />

      <SectionTitle>{L.card.loomHistory}</SectionTitle>
      {events.length === 0 ? (
        <p className="text-sm text-muted">{L.card.noHistory}</p>
      ) : (
        <Card className="p-0">
          <ol className="divide-y divide-line" aria-label={L.card.loomHistory}>
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm" data-event={e.event}>
                <span><b>{L.card.loomEvents[e.event]}</b> <Link href={`/beams/${e.beam_id}`} className="font-semibold text-brand">{e.beam_no}</Link></span>
                <span className="tnum shrink-0 text-xs text-muted">{fmtDateTime(e.at)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}

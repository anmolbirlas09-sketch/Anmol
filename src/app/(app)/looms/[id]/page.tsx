import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Badge, Card, Notice, PageHeader, SectionTitle, Stat, buttonClass, type Tone } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { getLoomStatus, listPreparedBeams, listTakeoffs } from '@/lib/data/looms';
import { fmtDateTime, fmtKg, fmtM, todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import type { LoomStatus } from '@/lib/types';
import { finishBeamAction, unloadBeamAction } from '../actions';
import { LoadBeamForm } from '../LoadBeamForm';
import { TakeoffForm } from '../TakeoffForm';
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
  const [takeoffs, prepared] = await Promise.all([
    listTakeoffs(db, { loomId: id, limit: 20 }),
    loom.status === 'idle' && mayWork ? listPreparedBeams(db) : Promise.resolve([]),
  ]);
  const here = `/looms/${id}`;
  const beamTakeoffs = takeoffs.filter((t) => t.beam_id === loom.beam_id).length;

  return (
    <>
      <PageHeader
        title={loom.machine_no}
        back="/looms"
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge tone={tone[loom.status]}>{L.loom.statuses[loom.status]}</Badge> {loom.factory_code}
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
                <Link href={`/beams/${loom.beam_id}`} className="text-xl font-bold text-brand">{loom.beam_no}</Link>
                <div className="text-sm">{loom.fabric_quality_name}</div>
                <div className="text-xs text-muted">{L.loom.loadedAt} {fmtDateTime(loom.loaded_at)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={L.loom.producedSoFar} value={fmtM(loom.meters_on_beam)} unit="m" />
              <Stat label={L.grey.produced} value={fmtKg(loom.kgs_on_beam)} unit="kg" />
              <Stat label={L.beam.warp} value={fmtKg(loom.warp_kg)} unit="kg" />
              <Stat label={L.beam.weft} value={fmtKg(loom.weft_kg)} unit="kg" />
            </div>
          </Card>

          {mayWork && (
            <>
              <SectionTitle>{L.takeoff.title}</SectionTitle>
              <Card>
                <TakeoffForm looms={[loom]} fixedLoomId={loom.loom_id} today={todayIST()} returnTo={here} />
              </Card>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <form action={finishBeamAction}>
                  <input type="hidden" name="beam_id" value={loom.beam_id} />
                  <input type="hidden" name="return" value={here} />
                  <ConfirmButton message={L.loom.finishConfirm(loom.beam_no ?? '')} className={`${buttonClass.secondary} w-full`}>
                    {L.loom.finish}
                  </ConfirmButton>
                </form>
                {canEdit(user) && beamTakeoffs === 0 && (
                  <form action={unloadBeamAction}>
                    <input type="hidden" name="beam_id" value={loom.beam_id} />
                    <input type="hidden" name="return" value={here} />
                    <ConfirmButton message={L.loom.unloadConfirm} className={`${buttonClass.danger} w-full`}>
                      {L.loom.unload}
                    </ConfirmButton>
                  </form>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-muted">{L.loom.noBeam}</p>
          {mayWork && loom.status === 'idle' && (
            <Card>
              <h2 className="mb-3 font-semibold">{L.loom.load}</h2>
              <LoadBeamForm beams={prepared} looms={[]} fixedLoom={loom} />
            </Card>
          )}
        </>
      )}

      <SectionTitle>{L.takeoff.recent}</SectionTitle>
      <TakeoffList rows={takeoffs} canDelete={canEdit(user)} returnTo={here} show="beam" />
    </>
  );
}

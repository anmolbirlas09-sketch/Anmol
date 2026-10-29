import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Card, Notice, PageHeader, SectionTitle, Stat, buttonClass, cx } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { getBeamSummary, getConsumptionLines } from '@/lib/data/beams';
import { listLoomStatus, listTakeoffs } from '@/lib/data/looms';
import { getFabricQuality } from '@/lib/data/masters';
import { listOpenLots } from '@/lib/data/yarn';
import { fmtDate, fmtDateTime, fmtKg, fmtM, fmtPct, todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import type { BeamSummary, ConsumptionLineView, UsageType } from '@/lib/types';
import { deleteConsumptionAction } from '../actions';
import { finishBeamAction } from '../../looms/actions';
import { LoadBeamForm } from '../../looms/LoadBeamForm';
import { TakeoffList } from '../../looms/TakeoffList';
import { BeamStatusBadge } from '../BeamStatusBadge';
import { ConsumptionForm } from './ConsumptionForm';

export const metadata: Metadata = { title: L.beam.title };

export default async function BeamPage({ params, searchParams }: PageProps<'/beams/[id]'>) {
  const user = await requireUser();
  const { id } = await params;
  const { created, error } = await searchParams;
  const db = await createClient();
  const beam = await getBeamSummary(db, id).catch(() => null);
  if (!beam) notFound();
  const [lines, lots, fq, takeoffs, looms] = await Promise.all([
    getConsumptionLines(db, id),
    listOpenLots(db),
    getFabricQuality(db, beam.fabric_quality_id),
    listTakeoffs(db, { beamId: id, limit: 200 }),
    beam.status === 'prepared' ? listLoomStatus(db, { factoryId: user.factory_id ?? undefined }) : Promise.resolve([]),
  ]);
  const editable = canEdit(user);
  const here = `/beams/${beam.beam_id}`;

  return (
    <>
      <PageHeader
        title={L.beam.beamTitle(beam.beam_no)}
        back="/beams"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <BeamStatusBadge status={beam.status} />
            {beam.fabric_quality_name} · {beam.factory_code}
            {beam.machine_no && ` · ${L.beam.loom} ${beam.machine_no}`}
          </span>
        }
      />
      {created && (
        <div className="mb-4">
          <Notice tone="ok">{L.beam.created(beam.beam_no)}</Notice>
        </div>
      )}

      {typeof error === 'string' && (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      <PlannedVsActual beam={beam} />

      <SectionTitle>{L.beam.loom}</SectionTitle>
      {beam.status === 'prepared' && (
        <Card>
          <LoadBeamForm beams={[]} looms={looms.filter((l) => l.status === 'idle')} fixedBeam={beam} />
        </Card>
      )}
      {beam.status === 'on_loom' && beam.loom_id && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/looms/${beam.loom_id}`} className="text-lg font-bold text-brand">
              {L.beam.onLoom(beam.machine_no ?? '')}
            </Link>
            <div className="text-xs text-muted">{L.loom.loadedAt} {fmtDateTime(beam.loaded_at)}</div>
          </div>
          <div className="flex gap-2">
            <Link href={`/looms/${beam.loom_id}`} className={buttonClass.primary}>{L.takeoff.short}</Link>
            <form action={finishBeamAction}>
              <input type="hidden" name="beam_id" value={beam.beam_id} />
              <input type="hidden" name="return" value={here} />
              <ConfirmButton message={L.loom.finishConfirm(beam.beam_no)} className={buttonClass.secondary}>
                {L.loom.finish}
              </ConfirmButton>
            </form>
          </div>
        </Card>
      )}
      {beam.status === 'finished' && (
        <p className="text-sm text-muted">
          {L.beam.statuses.finished} {fmtDateTime(beam.finished_at)}
          {beam.machine_no ? ` · ${beam.machine_no}` : ''}
        </p>
      )}

      {beam.takeoff_count > 0 && (
        <>
          <SectionTitle>{L.beam.yield}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="beam-yield">
            <Stat label={L.beam.greyProduced} value={fmtM(beam.grey_meters)} unit="m" />
            <Stat label={`${L.beam.greyProduced} kg`} value={fmtKg(beam.grey_kg)} unit="kg" />
            <Stat label={L.beam.wastage} value={`${fmtKg(beam.wastage_kg)} kg`} unit={beam.wastage_pct != null ? `(${beam.wastage_pct.toFixed(2)}%)` : undefined} tone={beam.wastage_kg < 0 ? 'bad' : undefined} />
            <Stat label={L.takeoff.metersPerKg} value={beam.meters_per_kg != null ? beam.meters_per_kg.toFixed(3) : L.app.none} />
          </div>
        </>
      )}

      <SectionTitle>{L.beam.addConsumption}</SectionTitle>
      <Card>
        <ConsumptionForm
          beamId={beam.beam_id}
          lots={lots}
          today={todayIST()}
          expected={{
            warp: { id: fq?.warp_yarn_quality_id ?? null, name: fq?.warp_yarn_quality_name ?? null },
            weft: { id: fq?.weft_yarn_quality_id ?? null, name: fq?.weft_yarn_quality_name ?? null },
          }}
        />
      </Card>

      <SectionTitle>{L.beam.consumption}</SectionTitle>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">{L.beam.noLines}</p>
      ) : (
        <div className="space-y-3">
          {(['warp', 'weft'] as UsageType[]).map((u) => (
            <Lines key={u} usage={u} lines={lines.filter((l) => l.usage_type === u)} editable={editable} beamId={beam.beam_id} />
          ))}
        </div>
      )}

      <SectionTitle>{L.beam.takeoffs}</SectionTitle>
      <TakeoffList rows={takeoffs} canDelete={editable} returnTo={here} show="loom" />

      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          [L.beam.warpLength, `${fmtM(beam.warp_length_m)} m`],
          [L.beam.expectedFabric, `${fmtM(beam.expected_fabric_length_m)} m`],
          [L.beam.createdDate, fmtDate(beam.created_date)],
          [L.beam.greyProduced, beam.takeoff_count ? `${fmtM(beam.grey_meters)} m / ${fmtKg(beam.grey_kg)} kg` : L.app.none],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="tnum font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function PlannedVsActual({ beam }: { beam: BeamSummary }) {
  const rows = [
    { label: L.beam.warp, planned: beam.planned_warp_kg, actual: beam.warp_kg, variance: beam.warp_variance_pct, flag: beam.warp_variance_flag },
    { label: L.beam.weft, planned: beam.planned_weft_kg, actual: beam.weft_kg, variance: beam.weft_variance_pct, flag: beam.weft_variance_flag },
  ];
  const plannedTotal = beam.planned_warp_kg != null && beam.planned_weft_kg != null ? beam.planned_warp_kg + beam.planned_weft_kg : null;
  const missing = beam.planned_warp_kg == null || beam.planned_weft_kg == null;

  return (
    <Card className="p-0">
      <table className="tnum w-full text-right text-sm">
        <caption className="px-4 pt-3 text-left text-sm font-semibold">{L.beam.plannedVsActual}</caption>
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-semibold"><span className="sr-only">Yarn</span></th>
            <th scope="col" className="px-2 py-2 font-semibold">{L.beam.planned}</th>
            <th scope="col" className="px-2 py-2 font-semibold">{L.beam.actual}</th>
            <th scope="col" className="px-4 py-2 font-semibold">{L.beam.variance}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-t border-line">
          {rows.map((r) => (
            <tr key={r.label} className={cx(r.flag && 'bg-bad-soft')}>
              <th scope="row" className="px-4 py-3 text-left font-semibold">{r.label}</th>
              <td className="px-2 py-3">{fmtKg(r.planned)}</td>
              <td className="px-2 py-3 text-base font-bold">{fmtKg(r.actual)}</td>
              <td className={cx('px-4 py-3 font-semibold', r.flag && 'text-bad')} data-flag={r.flag || undefined}>
                {fmtPct(r.variance)}
                {r.flag && <span className="sr-only"> (over limit)</span>}
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="px-4 py-3 text-left font-semibold">{L.beam.total}</th>
            <td className="px-2 py-3">{fmtKg(plannedTotal)}</td>
            <td className="px-2 py-3 text-base font-bold">{fmtKg(beam.total_yarn_kg)}</td>
            <td className="px-4 py-3" />
          </tr>
        </tbody>
      </table>
      <p className="px-4 pb-3 pt-1 text-xs text-muted">
        {missing ? L.beam.missingPlan : L.beam.threshold(String(beam.variance_threshold_pct))}
      </p>
    </Card>
  );
}

function Lines({ usage, lines, editable, beamId }: { usage: UsageType; lines: ConsumptionLineView[]; editable: boolean; beamId: string }) {
  if (!lines.length) return null;
  const total = lines.reduce((s, l) => s + Number(l.kgs), 0);
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h3 className="font-semibold">{usage === 'warp' ? L.beam.warp : L.beam.weft}</h3>
        <span className="tnum font-bold">{fmtKg(total)} kg</span>
      </div>
      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link href={`/yarn/${l.yarn_lot_id}`} className="font-semibold text-brand">
                {l.lot_no}
              </Link>
              <span className="text-sm"> · {l.yarn_quality_name}</span>
              <div className="text-xs text-muted">
                {fmtDate(l.entry_date)}
                {l.created_by_name ? ` · ${l.created_by_name}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="tnum font-semibold">{fmtKg(l.kgs)}</span>
              {editable && (
                <form action={deleteConsumptionAction}>
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="beam_id" value={beamId} />
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

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmButton } from '@/components/ConfirmButton';
import { SpecDetails } from '@/components/SpecPicker';
import { Card, LinkButton, Notice, PageHeader, SectionTitle, Stat, buttonClass, cx } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { getBeamSummary, getConsumptionLines, listBeamEvents } from '@/lib/data/beams';
import { listLoomStatus, listTakeoffs } from '@/lib/data/looms';
import { getFabricQuality } from '@/lib/data/masters';
import { listOpenLots } from '@/lib/data/yarn';
import { fmtDate, fmtDateTime, fmtKg, fmtM, fmtPct, todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import type { BeamSummary, ConsumptionLineView, UsageType } from '@/lib/types';
import { deleteConsumptionAction } from '../actions';
import { finishBeamAction, unloadBeamAction } from '../../looms/actions';
import { LoadBeamForm } from '../../looms/LoadBeamForm';
import { TakeoffList } from '../../looms/TakeoffList';
import { BeamStatusBadge } from '../BeamStatusBadge';
import { ConsumptionForm } from './ConsumptionForm';

export const metadata: Metadata = { title: L.beam.title };

export default async function BeamPage({ params, searchParams }: PageProps<'/beams/[id]'>) {
  const user = await requireUser();
  const { id } = await params;
  const { created, saved, error } = await searchParams;
  const db = await createClient();
  const beam = await getBeamSummary(db, id).catch(() => null);
  if (!beam) notFound();
  const mayWork = !user.factory_id || !beam.factory_id || user.factory_id === beam.factory_id;
  const [lines, lots, fq, takeoffs, looms, events] = await Promise.all([
    getConsumptionLines(db, id),
    listOpenLots(db),
    beam.fabric_quality_id ? getFabricQuality(db, beam.fabric_quality_id) : Promise.resolve(null),
    listTakeoffs(db, { beamId: id, limit: 500 }),
    beam.status === 'prepared' && mayWork ? listLoomStatus(db, { factoryId: user.factory_id ?? undefined }) : Promise.resolve([]),
    listBeamEvents(db, { beamId: id }),
  ]);
  const editable = canEdit(user);
  const here = `/beams/${beam.beam_id}`;
  const card = cardFields(beam);
  const missing = card.flatMap((g) => g.fields).filter((f) => f.value === null).length;

  return (
    <>
      <PageHeader
        title={L.beam.beamTitle(beam.beam_no)}
        back="/beams"
        action={editable ? <LinkButton href={`${here}/edit`} variant="secondary">{L.card.edit}</LinkButton> : undefined}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <BeamStatusBadge status={beam.status} unloaded={beam.status === 'prepared' && beam.takeoff_count > 0} />
            {beam.fabric_quality_name ?? L.beam.noQuality} · <span data-testid="beam-spec">{beam.spec_code ?? L.beam.noSpec}</span>
            {beam.factory_code && ` · ${beam.factory_code}`}
            {beam.machine_no && beam.status === 'on_loom' && ` · ${L.beam.loom} ${beam.machine_no}`}
            <span className="text-xs">· {L.card.cardNo(beam.card_no)}</span>
          </span>
        }
      />
      {(created || saved) && (
        <div className="mb-4"><Notice tone="ok">{L.card.saved(beam.beam_no)}</Notice></div>
      )}
      {typeof error === 'string' && (
        <div className="mb-4"><Notice tone="bad">{error}</Notice></div>
      )}

      <SectionTitle>{L.card.status}</SectionTitle>
      {beam.status === 'prepared' && mayWork && (
        <Card>
          <h2 className="mb-3 font-semibold">{L.loom.load}</h2>
          <LoadBeamForm beams={[]} looms={looms.filter((l) => l.status !== 'maintenance')} fixedBeam={beam} canUnload={editable} />
        </Card>
      )}
      {beam.status === 'on_loom' && beam.loom_id && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/looms/${beam.loom_id}`} className="text-lg font-bold text-brand" data-testid="beam-loom">
              {L.beam.onLoom(beam.machine_no ?? '')}
            </Link>
            <div className="text-xs text-muted">{L.loom.loadedAt} {fmtDateTime(beam.loaded_at)}</div>
          </div>
          {mayWork && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/looms/${beam.loom_id}`} className={buttonClass.primary}>{L.takeoff.short}</Link>
              {editable && (
                <form action={unloadBeamAction}>
                  <input type="hidden" name="beam_id" value={beam.beam_id} />
                  <input type="hidden" name="return" value={here} />
                  <ConfirmButton message={L.loom.unloadConfirm} className={buttonClass.secondary}>{L.loom.unload}</ConfirmButton>
                </form>
              )}
              <form action={finishBeamAction}>
                <input type="hidden" name="beam_id" value={beam.beam_id} />
                <input type="hidden" name="return" value={here} />
                <ConfirmButton message={L.loom.finishConfirm(beam.beam_no)} className={buttonClass.secondary}>
                  {L.loom.finish}
                </ConfirmButton>
              </form>
            </div>
          )}
        </Card>
      )}
      {beam.status === 'finished' && (
        <p className="text-sm text-muted">
          {L.beam.statuses.finished} {fmtDateTime(beam.finished_at)}
          {beam.machine_no ? ` · ${beam.machine_no}` : ''}
        </p>
      )}

      <SectionTitle
        action={editable && missing > 0 ? <Link href={`${here}/edit`} className="text-sm font-semibold text-brand">{L.card.complete}</Link> : undefined}
      >
        {L.card.title}
      </SectionTitle>
      <Card data-testid="beam-card">
        <p className={cx('mb-3 text-sm font-semibold', missing ? 'text-warn' : 'text-ok')} data-testid="card-missing">
          {missing ? L.card.missing(missing) : L.card.allFilled}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {card.map((g) => (
            <div key={g.title}>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{g.title}</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {g.fields.map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className={cx('tnum font-semibold', f.value === null && 'font-normal text-muted')} data-field={f.label}>{f.value ?? L.card.notSet}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Card>

      {beam.spec_code && <div className="mt-4"><SpecDetails spec={{ ...beam, spec_code: beam.spec_code }} /></div>}

      <div className="mt-4"><PlannedVsActual beam={beam} /></div>

      {beam.takeoff_count > 0 && (
        <>
          <SectionTitle>{L.beam.yield}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="beam-yield">
            <Stat label={L.production.total} value={fmtM(beam.grey_meters)} unit="m" />
            <Stat label={L.production.wasted} value={fmtM(beam.wasted_meters)} unit="m" />
            <Stat label={L.production.net} value={fmtM(beam.net_meters)} unit="m" />
            <Stat label={L.production.wastagePct} value={beam.wastage_pct !== null ? `${beam.wastage_pct.toFixed(2)}%` : L.app.none} sub={`${beam.roll_count} ${L.production.rollsTitle.toLowerCase()}`} />
          </div>
          {[beam.estimated_kg, beam.grey_kg, beam.prod_warp_kg, beam.prod_weft_kg, beam.waste_kg_actual, beam.waste_kg_estimated].some((x) => x !== null) && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="beam-weights">
              <Stat label={`${L.production.estimatedKg} (${L.production.estimatedTag})`} value={beam.estimated_kg !== null ? fmtKg(beam.estimated_kg) : L.app.none} unit={beam.estimated_kg !== null ? 'kg' : undefined} />
              <Stat label={`${L.reports.col.weighedKg} (${L.production.actualTag})`} value={beam.grey_kg !== null ? fmtKg(beam.grey_kg) : L.app.none} unit={beam.grey_kg !== null ? 'kg' : undefined}
                sub={beam.meters_per_kg !== null ? `${beam.meters_per_kg.toFixed(3)} ${L.takeoff.metersPerKg}` : undefined} />
              <Stat label={L.beam.yarnRecorded} value={beam.prod_total_yarn_kg !== null ? fmtKg(beam.prod_total_yarn_kg) : L.app.none} unit={beam.prod_total_yarn_kg !== null ? 'kg' : undefined}
                sub={`${L.beam.warp} ${beam.prod_warp_kg !== null ? fmtKg(beam.prod_warp_kg) : L.app.none} · ${L.beam.weft} ${beam.prod_weft_kg !== null ? fmtKg(beam.prod_weft_kg) : L.app.none}`} />
              <Stat label={L.production.kgWastageTitle}
                value={beam.waste_kg_actual !== null ? `${fmtKg(beam.waste_kg_actual)} kg` : beam.waste_kg_estimated !== null ? `≈${fmtKg(beam.waste_kg_estimated)} kg` : L.app.none}
                sub={beam.waste_kg_actual !== null
                  ? `${L.production.actualTag}${beam.weight_wastage_pct_actual !== null ? ` · ${beam.weight_wastage_pct_actual.toFixed(2)}%` : ''}`
                  : beam.waste_kg_estimated !== null ? L.production.estimatedTag : undefined} />
            </div>
          )}
        </>
      )}

      <SectionTitle>{L.card.history}</SectionTitle>
      {events.length === 0 ? (
        <p className="text-sm text-muted">{L.card.noHistory}</p>
      ) : (
        <Card className="p-0">
          <ol className="divide-y divide-line" aria-label={L.card.history}>
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm" data-event={e.event}>
                <span>
                  <b>{L.card.events[e.event]}</b>{' '}
                  <Link href={`/looms/${e.loom_id}`} className="font-semibold text-brand">{e.machine_no}</Link>
                  {e.meters_so_far !== null && e.event !== 'loaded' && <span className="text-muted"> · {L.card.soFar(fmtM(e.meters_so_far))}</span>}
                </span>
                <span className="tnum shrink-0 text-xs text-muted">{fmtDateTime(e.at)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <SectionTitle>{L.card.productionHistory}</SectionTitle>
      <TakeoffList rows={takeoffs} canDelete={editable} returnTo={here} show="loom" />

      <SectionTitle>{L.beam.addConsumption}</SectionTitle>
      <Card>
        <ConsumptionForm
          beamId={beam.beam_id}
          lots={lots}
          today={todayIST()}
          expected={{
            // the specification's yarns (falling back to the card's, then the parent quality's)
            warp: { id: beam.spec_warp_yarn_quality_id ?? beam.card_warp_yarn_quality_id ?? fq?.warp_yarn_quality_id ?? null, name: beam.warp_yarn_quality_name ?? null },
            weft: { id: beam.spec_weft_yarn_quality_id ?? beam.card_weft_yarn_quality_id ?? fq?.weft_yarn_quality_id ?? null, name: beam.weft_yarn_quality_name ?? null },
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
    </>
  );
}

/** The 20 beam card fields in the factory card's groups (null = not filled in). */
function cardFields(b: BeamSummary): { title: string; fields: { label: string; value: string | null }[] }[] {
  const C = L.card;
  const n = (v: number | null, f: (x: number) => string = String) => (v === null ? null : f(v));
  return [
    { title: C.sIdentification, fields: [
      { label: C.beamNo, value: b.beam_no_entered },
      { label: C.makingDate, value: b.created_date ? fmtDate(b.created_date) : null },
      { label: C.quality, value: b.fabric_quality_name },
    ] },
    { title: C.sWarpWeft, fields: [
      { label: C.warp, value: b.warp_yarn_quality_name },
      { label: C.reed, value: n(b.reed) },
      { label: C.totalEnds, value: n(b.total_ends) },
      { label: C.reedSpace, value: n(b.reed_space_in) },
      { label: C.weft, value: b.weft_yarn_quality_name },
      { label: C.picks, value: n(b.picks_on_loom) },
    ] },
    { title: C.sMeasure, fields: [
      { label: C.counterMeter, value: n(b.warp_length_m, fmtM) },
      { label: C.rollingMeter, value: n(b.rolling_meter, fmtM) },
      { label: C.warpWeight, value: n(b.warp_weight_kg, fmtKg) },
      { label: C.gw, value: n(b.gross_weight_kg, fmtKg) },
      { label: C.fw, value: n(b.finished_weight_kg, fmtKg) },
      { label: C.weftWeight, value: n(b.weft_weight_kg, fmtKg) },
    ] },
    { title: C.sWeaving, fields: [{ label: C.weave, value: b.weave }] },
    { title: C.sDates, fields: [
      { label: C.gettingDate, value: b.getting_date ? fmtDate(b.getting_date) : null },
      { label: C.finishExpected, value: b.expected_finish_date ? fmtDate(b.expected_finish_date) : null },
      { label: C.finishActual, value: b.actual_finish_date ? fmtDate(b.actual_finish_date) : null },
    ] },
    { title: C.sLoom, fields: [{ label: C.loom, value: b.machine_no }] },
  ];
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

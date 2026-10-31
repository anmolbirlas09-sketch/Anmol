'use client';

import { useActionState, useEffect, useState } from 'react';
import { Combobox } from '@/components/Combobox';
import { SubmitButton } from '@/components/form';
import { Badge, Field, Notice, cx, inputClass } from '@/components/ui';
import { fmtKg, fmtM, fmtPct } from '@/lib/format';
import { L } from '@/lib/labels';
import { describeRolls, productionFigures } from '@/lib/production';
import type { FabricQualityView, LoomStatusRow } from '@/lib/types';
import { SHIFTS, type FormState } from '@/lib/validation';
import { productionAction } from './actions';

const P = L.production;

/** '' → null, otherwise the number (commas allowed). Blank stays "not recorded". */
const num = (s: string): number | null => {
  const t = s.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const newRef = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`);

// Fields cleared after each save; loom, quality, date, shift, roll length, GSM and width stay for the next entry.
const PER_ENTRY = ['meters', 'wasted_meters', 'weighed_kg', 'warp_kg', 'weft_kg', 'waste_kg', 'waste_pct'] as const;
type FieldName = (typeof PER_ENTRY)[number] | 'roll_length_m' | 'gsm' | 'width_m';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
        <span className="flex size-6 items-center justify-center rounded-full bg-brand text-xs text-brand-ink">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Figure({ label, value, tone, testId }: { label: string; value: string; tone?: 'bad' | 'ok'; testId?: string }) {
  return (
    <div className="rounded-lg bg-surface p-2" data-testid={testId}>
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={cx('tnum text-lg font-bold', tone === 'bad' && 'text-bad', tone === 'ok' && 'text-ok')}>{value}</div>
    </div>
  );
}

/**
 * Metre-first production entry:
 * 1 loom + quality → 2 total metres → 3 roll length → 4 wasted metres →
 * 5 net / wastage % (automatic) → 6 optional weights and KG wastage → 7 save.
 */
export function ProductionForm({
  looms, qualities, fixedLoomId, defaultLoomId, today, shiftNow, returnTo,
}: {
  looms: LoomStatusRow[];
  qualities: FabricQualityView[];
  fixedLoomId?: string;
  defaultLoomId?: string;
  today: string;
  /** The shift running now and its production date (night after midnight = yesterday's night). */
  shiftNow: { shift: string; date: string };
  /** Page to come back to if the beam is finished. */
  returnTo?: string;
}) {
  const [state, action] = useActionState(productionAction, {} as FormState);
  const [loomId, setLoomId] = useState(fixedLoomId ?? defaultLoomId ?? '');
  const loom = looms.find((l) => l.loom_id === loomId);
  const [qualityId, setQualityId] = useState(loom?.fabric_quality_id ?? '');
  const [v, setV] = useState<Record<FieldName, string>>({
    meters: '', wasted_meters: '', roll_length_m: '', gsm: '', width_m: '',
    weighed_kg: '', warp_kg: '', weft_kg: '', waste_kg: '', waste_pct: '',
  });
  const [finish, setFinish] = useState(false);
  const [clientRef, setClientRef] = useState(newRef);
  const set = (k: FieldName) => (e: React.ChangeEvent<HTMLInputElement>) => setV((o) => ({ ...o, [k]: e.target.value }));

  useEffect(() => {
    if (state.ok) {
      setV((o) => ({ ...o, ...Object.fromEntries(PER_ENTRY.map((k) => [k, ''])) }));
      setFinish(false);
      setClientRef(newRef()); // next entry is a new record
      if (!fixedLoomId && state.values?.finished) setLoomId('');
    } else if (state.values) {
      const sv = state.values;
      setV((o) => ({ ...o, ...Object.fromEntries(Object.keys(o).map((k) => [k, sv[k] ?? ''])) }));
    }
  }, [state, fixedLoomId]);

  const pickLoom = (id: string) => {
    setLoomId(id);
    setQualityId(looms.find((l) => l.loom_id === id)?.fabric_quality_id ?? '');
  };

  const fig = productionFigures({
    meters: num(v.meters), wastedMeters: num(v.wasted_meters), rollLengthM: num(v.roll_length_m),
    gsm: num(v.gsm), widthM: num(v.width_m), weighedKg: num(v.weighed_kg),
    warpKg: num(v.warp_kg), weftKg: num(v.weft_kg), wasteKg: num(v.waste_kg), wastePct: num(v.waste_pct),
  });
  const quality = qualities.find((q) => q.id === qualityId);
  const mismatch = loom && qualityId && loom.fabric_quality_id && qualityId !== loom.fabric_quality_id;
  const wastedTooMuch = num(v.wasted_meters) !== null && num(v.meters) !== null && num(v.wasted_meters)! > num(v.meters)!;
  const err = state.fieldErrors ?? {};
  const showWeight = Boolean(v.gsm || v.width_m || v.weighed_kg || v.warp_kg || v.weft_kg);

  if (looms.length === 0) {
    return (
      <div className="space-y-3">
        {state.ok && state.message && <Notice tone="ok">{state.message}</Notice>}
        <Notice tone="warn">{L.takeoff.noRunning}</Notice>
      </div>
    );
  }

  const numberInput = (name: FieldName, label: string, opts: { hint?: React.ReactNode; big?: boolean; optional?: boolean; error?: string } = {}) => (
    <Field label={label} htmlFor={name} error={opts.error ?? err[name]} hint={opts.hint} optional={opts.optional}>
      <input
        id={name}
        name={name}
        value={v[name]}
        onChange={set(name)}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={opts.error || err[name] ? true : undefined}
        aria-describedby={opts.error || err[name] ? `${name}-error` : undefined}
        className={cx(inputClass, 'tnum', opts.big && 'text-lg font-semibold')}
      />
    </Field>
  );

  return (
    <form action={action} className="space-y-6" noValidate>
      {state.ok && state.message && <Notice tone="ok">{state.message}</Notice>}
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <input type="hidden" name="machine_no" value={loom?.machine_no ?? ''} />
      <input type="hidden" name="beam_no" value={loom?.beam_no ?? ''} />
      <input type="hidden" name="client_ref" value={clientRef} />
      {returnTo && <input type="hidden" name="return" value={returnTo} />}

      <Step n={1} title={P.step1}>
        {fixedLoomId ? (
          <input type="hidden" name="loom_id" value={fixedLoomId} />
        ) : (
          <Field label={L.takeoff.loom} htmlFor="loom_id" error={err.loom_id}>
            <Combobox
              id="loom_id"
              name="loom_id"
              value={loomId}
              onChange={pickLoom}
              invalid={Boolean(err.loom_id)}
              options={looms.map((l) => ({ value: l.loom_id, label: l.machine_no, detail: `${l.beam_no} · ${l.fabric_quality_name}`, group: l.factory_code }))}
            />
          </Field>
        )}
        <Field label={P.fabricQuality} htmlFor="fabric_quality_id" error={err.fabric_quality_id}>
          <select id="fabric_quality_id" name="fabric_quality_id" value={qualityId} onChange={(e) => setQualityId(e.target.value)} className={inputClass}>
            <option value="">{L.app.select}</option>
            {qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        </Field>
        {loom && (
          <div className="rounded-lg bg-sunken p-3 text-sm" data-testid="takeoff-beam">
            <div className="font-semibold">{L.takeoff.beamOnLoom(loom.beam_no ?? '', loom.fabric_quality_name ?? '')}</div>
            <div className="tnum text-muted">{L.takeoff.soFar(fmtM(loom.meters_on_beam ?? 0), fmtM(loom.expected_fabric_length_m))}</div>
          </div>
        )}
        {mismatch && <Notice tone="bad">{P.qualityMismatch(loom.beam_no ?? '', loom.fabric_quality_name ?? '')}</Notice>}
      </Step>

      <Step n={2} title={P.step2}>
        {numberInput('meters', P.meters, { big: true })}
      </Step>

      <Step n={3} title={P.step3}>
        {numberInput('roll_length_m', P.rollLength, { hint: P.rollLengthHint })}
      </Step>

      <Step n={4} title={P.step4}>
        {numberInput('wasted_meters', P.wastedQuestion, {
          big: true,
          hint: P.wastedHint,
          error: wastedTooMuch ? P.wastedTooMuch : undefined,
        })}
      </Step>

      {/* Step 5: automatic */}
      <div className="rounded-xl bg-sunken p-3" aria-live="polite" data-testid="production-figures">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure testId="fig-total" label={P.total} value={num(v.meters) !== null ? `${fmtM(num(v.meters))} m` : L.app.none} />
          <Figure testId="fig-wasted" label={P.wasted} value={num(v.wasted_meters) !== null ? `${fmtM(num(v.wasted_meters))} m` : L.app.none} tone={wastedTooMuch ? 'bad' : undefined} />
          <Figure testId="fig-net" label={P.net} value={fig.netMeters !== null ? `${fmtM(fig.netMeters)} m` : L.app.none} tone="ok" />
          <Figure testId="fig-pct" label={P.wastagePct} value={fig.wastagePct !== null ? fmtPct(fig.wastagePct).replace('+', '') : L.app.none} />
        </div>
        {fig.rolls.length > 0 && (
          <p className="mt-2 text-sm font-medium" data-testid="rolls-preview">{P.rollsPreview(describeRolls(fig.rolls), fig.rolls.length)}</p>
        )}
      </div>

      <details open={showWeight || undefined} className="group rounded-xl border border-line p-3">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between font-semibold">
          <span className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-sunken text-xs">6</span>
            {P.step6}
          </span>
          <span aria-hidden className="text-muted group-open:rotate-180">▾</span>
        </summary>
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {numberInput('gsm', P.gsm, { optional: true, hint: quality?.gsm ? P.gsmHint(String(quality.gsm)) : undefined })}
            {numberInput('width_m', P.width, { optional: true })}
          </div>
          <div className="flex items-center justify-between rounded-lg bg-sunken px-3 py-2 text-sm" data-testid="estimated-kg">
            <span>{P.estimatedKg} <Badge tone="warn">{P.estimatedTag}</Badge></span>
            <span className="tnum font-bold">{fig.estimatedKg !== null ? `${fmtKg(fig.estimatedKg)} kg` : <span className="font-normal text-muted">{P.estimatedNeeds}</span>}</span>
          </div>
          {numberInput('weighed_kg', P.weighedKg, { optional: true, hint: <Badge tone="ok">{P.actualTag}</Badge> })}
          <div className="grid grid-cols-2 gap-3">
            {numberInput('warp_kg', P.warpKg, { optional: true })}
            {numberInput('weft_kg', P.weftKg, { optional: true })}
          </div>
          <p className="-mt-2 text-xs text-muted">{P.yarnNote}</p>

          {fig.asksForKgWastage && (
            <section className="space-y-3 rounded-lg border border-warn/40 bg-warn-soft/40 p-3" aria-label={P.kgWastageTitle}>
              <h3 className="font-semibold">{P.kgWastageTitle}</h3>
              <p className="text-sm text-muted">{P.kgWastageHint}</p>
              {numberInput('waste_kg', P.wasteKgQ, { optional: true })}
              {numberInput('waste_pct', P.wastePctQ, { optional: true })}
              <dl className="tnum grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
                <div><dt className="text-muted">{P.totalYarn}</dt><dd className="font-semibold">{fig.totalYarnKg !== null ? `${fmtKg(fig.totalYarnKg)} kg` : L.app.none}</dd></div>
                <div><dt className="text-muted">{P.weightWastageActual}</dt><dd className="font-semibold" data-testid="weight-wastage-actual">{fig.weightWastagePctActual !== null ? `${fig.weightWastagePctActual.toFixed(2)}%` : L.app.none}</dd></div>
                <div><dt className="text-muted">{P.wasteKgEstimated}</dt><dd className="font-semibold" data-testid="waste-kg-estimated">{fig.wasteKgEstimated !== null ? `${fmtKg(fig.wasteKgEstimated)} kg` : (num(v.waste_pct) !== null && fig.totalYarnKg === null ? <span className="font-normal text-muted">{P.needYarnForPct}</span> : L.app.none)}</dd></div>
              </dl>
            </section>
          )}
        </div>
      </details>

      <div className="grid grid-cols-2 gap-4">
        <Field label={L.takeoff.date} htmlFor="entry_date" error={err.entry_date}>
          <input key={state.values?.entry_date ?? shiftNow.date} id="entry_date" name="entry_date" type="date" max={today}
            defaultValue={state.values?.entry_date ?? shiftNow.date} className={inputClass} />
        </Field>
        <Field label={L.takeoff.shift} htmlFor="shift" optional>
          <select key={state.values?.shift ?? shiftNow.shift} id="shift" name="shift" defaultValue={state.values?.shift ?? shiftNow.shift} className={inputClass}>
            <option value="">{L.app.none}</option>
            {SHIFTS.map((s) => <option key={s} value={s}>{L.takeoff.shifts[s]}</option>)}
          </select>
        </Field>
      </div>

      <label className={cx('flex min-h-12 items-start gap-3 rounded-lg border p-3 font-semibold', finish ? 'border-warn bg-warn-soft' : 'border-line')}>
        <input type="checkbox" name="finish_beam" checked={finish} onChange={(e) => setFinish(e.target.checked)} className="mt-0.5 size-5 accent-brand" />
        <span>{L.takeoff.finishBeam}</span>
      </label>

      <SubmitButton className="w-full" disabled={!loom || wastedTooMuch || Boolean(mismatch)}>{P.save}</SubmitButton>
    </form>
  );
}

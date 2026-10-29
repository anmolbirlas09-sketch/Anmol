'use client';

import { useActionState, useEffect, useState } from 'react';
import { Combobox } from '@/components/Combobox';
import { SubmitButton } from '@/components/form';
import { Field, Notice, cx, inputClass } from '@/components/ui';
import { fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import type { LoomStatusRow } from '@/lib/types';
import { SHIFTS, type FormState } from '@/lib/validation';
import { takeoffAction } from './actions';

const num = (s: string) => Number(s.replace(/,/g, ''));

/** Take-off: pick a running loom (its beam fills in), enter meters + kg. */
export function TakeoffForm({
  looms, fixedLoomId, defaultLoomId, today, returnTo,
}: {
  looms: LoomStatusRow[]; fixedLoomId?: string; defaultLoomId?: string; today: string; /** Page to come back to if the beam is finished. */ returnTo?: string;
}) {
  const [state, action] = useActionState(takeoffAction, {} as FormState);
  const [loomId, setLoomId] = useState(fixedLoomId ?? defaultLoomId ?? '');
  const [meters, setMeters] = useState('');
  const [kgs, setKgs] = useState('');
  const [finish, setFinish] = useState(false);

  useEffect(() => {
    if (state.ok) {
      setMeters('');
      setKgs('');
      setFinish(false);
      if (!fixedLoomId && state.values?.finished) setLoomId('');
    } else if (state.values) {
      setMeters(state.values.meters ?? '');
      setKgs(state.values.kgs ?? '');
    }
  }, [state, fixedLoomId]);

  const loom = looms.find((l) => l.loom_id === loomId);
  if (looms.length === 0) {
    // e.g. the take-off that just finished the last running beam: keep its confirmation visible.
    return (
      <div className="space-y-3">
        {state.ok && state.message && <Notice tone="ok">{state.message}</Notice>}
        <Notice tone="warn">{L.takeoff.noRunning}</Notice>
      </div>
    );
  }

  const m = num(meters);
  const k = num(kgs);
  const mpk = m > 0 && k > 0 ? m / k : null;
  const overYarn = loom && k > 0 && loom.total_yarn_kg != null && (loom.kgs_on_beam ?? 0) + k > loom.total_yarn_kg;
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.ok && state.message && <Notice tone="ok">{state.message}</Notice>}
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <input type="hidden" name="machine_no" value={loom?.machine_no ?? ''} />
      <input type="hidden" name="beam_no" value={loom?.beam_no ?? ''} />
      {returnTo && <input type="hidden" name="return" value={returnTo} />}

      {fixedLoomId ? (
        <input type="hidden" name="loom_id" value={fixedLoomId} />
      ) : (
        <Field label={L.takeoff.loom} htmlFor="loom_id" error={err.loom_id}>
          <Combobox
            id="loom_id"
            name="loom_id"
            value={loomId}
            onChange={setLoomId}
            invalid={Boolean(err.loom_id)}
            options={looms.map((l) => ({
              value: l.loom_id,
              label: l.machine_no,
              detail: `${l.beam_no} · ${l.fabric_quality_name}`,
              group: l.factory_code,
            }))}
          />
        </Field>
      )}

      {loom && (
        <div className="rounded-lg bg-sunken p-3 text-sm" data-testid="takeoff-beam">
          <div className="font-semibold">{L.takeoff.beamOnLoom(loom.beam_no ?? '', loom.fabric_quality_name ?? '')}</div>
          <div className="tnum text-muted">
            {L.takeoff.soFar(fmtM(loom.meters_on_beam ?? 0), fmtM(loom.expected_fabric_length_m))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label={L.takeoff.meters} htmlFor="meters" error={err.meters}>
          <input id="meters" name="meters" value={meters} onChange={(e) => setMeters(e.target.value)} inputMode="decimal" autoComplete="off"
            aria-invalid={err.meters ? true : undefined} className={`${inputClass} tnum text-lg font-semibold`} />
        </Field>
        <Field label={L.takeoff.kgs} htmlFor="kgs" error={err.kgs} hint={mpk ? `${mpk.toFixed(3)} ${L.takeoff.metersPerKg}` : undefined}>
          <input id="kgs" name="kgs" value={kgs} onChange={(e) => setKgs(e.target.value)} inputMode="decimal" autoComplete="off"
            aria-invalid={err.kgs ? true : undefined} className={`${inputClass} tnum text-lg font-semibold`} />
        </Field>
      </div>
      {overYarn && <Notice tone="warn">{L.takeoff.moreThanYarn}</Notice>}

      <div className="grid grid-cols-2 gap-4">
        <Field label={L.takeoff.date} htmlFor="entry_date" error={err.entry_date}>
          <input key={state.values?.entry_date ?? today} id="entry_date" name="entry_date" type="date" max={today}
            defaultValue={state.values?.entry_date ?? today} className={inputClass} />
        </Field>
        <Field label={L.takeoff.shift} htmlFor="shift" optional>
          <select key={state.values?.shift ?? ''} id="shift" name="shift" defaultValue={state.values?.shift ?? ''} className={inputClass}>
            <option value="">{L.app.none}</option>
            {SHIFTS.map((s) => (
              <option key={s} value={s}>{L.takeoff.shifts[s]}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={L.takeoff.rollNo} htmlFor="roll_no" optional>
        <input key={`roll-${state.ok ? state.message : ''}`} id="roll_no" name="roll_no" defaultValue={state.ok ? '' : state.values?.roll_no} autoComplete="off" className={inputClass} />
      </Field>

      <label className={cx('flex min-h-12 items-start gap-3 rounded-lg border p-3 font-semibold', finish ? 'border-warn bg-warn-soft' : 'border-line')}>
        <input type="checkbox" name="finish_beam" checked={finish} onChange={(e) => setFinish(e.target.checked)} className="mt-0.5 size-5 accent-brand" />
        <span>{L.takeoff.finishBeam}</span>
      </label>

      <SubmitButton className="w-full" disabled={!loom}>{L.takeoff.save}</SubmitButton>
    </form>
  );
}

'use client';

import { useActionState, useState } from 'react';
import { SpecPicker } from '@/components/SpecPicker';
import { SubmitButton, fieldProps, formKey } from '@/components/form';
import { Field, Notice, inputClass } from '@/components/ui';
import { fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import { expectedFabricLength, plannedWarpKg, plannedWeftKg } from '@/lib/planning';
import type { Factory, FabricQualityView, FabricSpecification } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { createBeamAction } from '../actions';

export function BeamForm({
  qualities, specs, factories, defaultFactoryId, today,
}: {
  qualities: FabricQualityView[]; specs: FabricSpecification[]; factories: Factory[]; defaultFactoryId?: string; today: string;
}) {
  const [state, action] = useActionState(createBeamAction, {} as FormState);
  const err = state.fieldErrors ?? {};
  const [qualityId, setQualityId] = useState(state.values?.fabric_quality_id ?? '');
  const [specId, setSpecId] = useState(state.values?.fabric_specification_id ?? '');
  const spec = specs.find((s) => s.id === specId);
  const [length, setLength] = useState(state.values?.warp_length_m ?? '');
  const fq = qualities.find((q) => q.id === qualityId);
  const len = Number(length.replace(/,/g, ''));
  const fabricLen = fq && len > 0 ? expectedFabricLength(len, fq.warp_crimp_pct) : null;
  const warp = fq ? plannedWarpKg({ totalEnds: fq.total_ends, warpLengthM: len, denier: spec?.warp_denier ?? fq.warp_denier, crimpPct: fq.warp_crimp_pct }) : null;
  const weft = fq && fabricLen
    ? plannedWeftKg({ picksPerInch: fq.picks_per_inch, reedWidthM: fq.reed_width_m, fabricLengthM: fabricLen, denier: spec?.weft_denier ?? fq.weft_denier, wastagePct: fq.weft_wastage_pct })
    : null;

  return (
    <form key={formKey(state)} action={action} className="space-y-4" noValidate>
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L.beam.beamNo} htmlFor="beam_no" error={err.beam_no}>
          <input {...fieldProps('beam_no', state)} autoCapitalize="characters" autoComplete="off" className={inputClass} />
        </Field>
        <Field label={L.beam.createdDate} htmlFor="created_date" error={err.created_date}>
          <input {...fieldProps('created_date', state, today)} type="date" max={today} className={inputClass} />
        </Field>
      </div>

      <SpecPicker
        qualities={qualities}
        specs={specs}
        qualityId={qualityId}
        specId={specId}
        onQuality={setQualityId}
        onSpec={setSpecId}
        errors={err}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L.beam.warpLength} htmlFor="warp_length_m" error={err.warp_length_m}>
          <input
            {...fieldProps('warp_length_m', state)}
            defaultValue={undefined}
            value={length}
            onChange={(e) => setLength(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            className={`${inputClass} tnum text-lg font-semibold`}
          />
        </Field>
        <Field label={L.beam.factory} htmlFor="factory_id" error={err.factory_id}>
          <select {...fieldProps('factory_id', state, defaultFactoryId ?? factories[0]?.id)} className={inputClass}>
            {factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {fq && len > 0 && (
        <div className="rounded-lg bg-sunken p-3 text-sm" aria-live="polite">
          <div className="mb-1 font-semibold">{L.beam.planned}</div>
          <div className="tnum grid grid-cols-3 gap-2">
            <div>
              <div className="text-muted">{L.beam.warp}</div>
              <div className="font-semibold">{warp == null ? L.app.none : `${fmtKg(warp)} kg`}</div>
            </div>
            <div>
              <div className="text-muted">{L.beam.weft}</div>
              <div className="font-semibold">{weft == null ? L.app.none : `${fmtKg(weft)} kg`}</div>
            </div>
            <div>
              <div className="text-muted">{L.beam.expectedFabric}</div>
              <div className="font-semibold">{fmtM(fabricLen)} m</div>
            </div>
          </div>
          {(warp == null || weft == null) && <p className="mt-2 text-muted">{L.beam.missingPlan}</p>}
        </div>
      )}

      <Field label={L.beam.notes} htmlFor="notes" optional>
        <textarea {...fieldProps('notes', state)} rows={2} className={`${inputClass} py-2`} />
      </Field>
      <SubmitButton className="w-full">{L.beam.newBeam}</SubmitButton>
    </form>
  );
}

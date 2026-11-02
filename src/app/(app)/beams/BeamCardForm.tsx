'use client';

import { useActionState, useState } from 'react';
import { SpecDetails } from '@/components/SpecPicker';
import { SubmitButton, fieldProps, formKey } from '@/components/form';
import { Field, Notice, cx, inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { BeamSummary, FabricQualityView, FabricSpecification, Factory, LoomStatusRow, YarnQuality } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { saveBeamCardAction } from './actions';

const C = L.card;

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-line bg-surface p-3" aria-label={title}>
      <legend className="flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wide text-muted">
        <span className="flex size-6 items-center justify-center rounded-full bg-brand text-xs text-brand-ink">{n}</span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export interface BeamCardFormProps {
  /** Editing a saved card (otherwise a new one). */
  beam?: BeamSummary;
  /** Quality / specification can no longer change (production recorded against them). */
  locked?: boolean;
  qualities: FabricQualityView[];
  specs: FabricSpecification[];
  yarns: YarnQuality[];
  factories: Factory[];
  /** Factory-scoped users always save at their factory. */
  fixedFactoryId?: string;
  /** Looms the user may load (all 68 for the owner), with the beam running on each. */
  looms: LoomStatusRow[];
  defaultLoomId?: string;
  /** Owner / supervisor: may take a running beam off unfinished. */
  canUnload?: boolean;
}

/**
 * The factory's beam card: 20 fields in 7 groups, every one optional. Save with
 * nothing filled in, or with just a beam number, and complete it later.
 */
export function BeamCardForm({ beam, locked, qualities, specs, yarns, factories, fixedFactoryId, looms, defaultLoomId, canUnload }: BeamCardFormProps) {
  const [state, action] = useActionState(saveBeamCardAction.bind(null, beam?.beam_id ?? null), {} as FormState);
  const err = state.fieldErrors ?? {};
  const sv = state.values;
  const init = (k: string, fromBeam: string | number | null | undefined) => sv?.[k] ?? str(fromBeam);

  const [qualityId, setQualityId] = useState(init('fabric_quality_id', beam?.fabric_quality_id));
  const [specChoice, setSpecChoice] = useState(init('fabric_specification_id', beam?.fabric_specification_id));
  const [loomId, setLoomId] = useState(sv?.loom_id ?? defaultLoomId ?? '');
  const ownSpecs = specs.filter((s) => s.fabric_quality_id === qualityId && (s.active || s.id === beam?.fabric_specification_id));
  const spec = specs.find((s) => s.id === specChoice);
  const isNew = specChoice === 'new';
  const loom = looms.find((l) => l.loom_id === loomId);
  const busyWith = loom?.beam_id && loom.beam_id !== beam?.beam_id ? loom.beam_no : null;
  const onLoom = beam?.status === 'on_loom';
  const finished = beam?.status === 'finished';

  const pickQuality = (id: string) => {
    setQualityId(id);
    const own = specs.filter((s) => s.fabric_quality_id === id && s.active);
    setSpecChoice(own.length === 1 ? own[0].id : '');
  };

  const num = (name: string, label: string, value: number | null | undefined, opts: { hint?: string; mode?: 'decimal' | 'numeric' } = {}) => (
    <Field label={label} htmlFor={name} error={err[name]} hint={opts.hint}>
      <input {...fieldProps(name, state, str(value))} inputMode={opts.mode ?? 'decimal'} autoComplete="off" className={cx(inputClass, 'tnum')} />
    </Field>
  );
  const date = (name: string, label: string, value: string | null | undefined) => (
    <Field label={label} htmlFor={name} error={err[name]}>
      <input {...fieldProps(name, state, str(value))} type="date" className={inputClass} />
    </Field>
  );
  const yarn = (name: string, label: string, value: string | null | undefined) => (
    <Field label={label} htmlFor={name} error={err[name]}>
      <select {...fieldProps(name, state, str(value))} className={inputClass}>
        <option value="">{C.notSet}</option>
        {yarns.map((y) => <option key={y.id} value={y.id}>{y.name}{y.denier ? ` (${y.denier} D)` : ''}</option>)}
      </select>
    </Field>
  );

  return (
    <form key={formKey(state)} action={action} className="space-y-4" noValidate>
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <p className="text-sm text-muted">{C.allOptional}</p>

      <Section n={1} title={C.sIdentification}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={C.beamNo} htmlFor="beam_no" error={err.beam_no} hint={beam ? undefined : C.beamNoHint}>
            <input {...fieldProps('beam_no', state, str(beam?.beam_no_entered))} autoCapitalize="characters" autoComplete="off" className={inputClass} />
          </Field>
          {date('created_date', C.makingDate, beam?.created_date)}
        </div>
      </Section>

      <Section n={2} title={C.sQuality}>
        {locked ? (
          <>
            <input type="hidden" name="fabric_quality_id" value={qualityId} />
            <input type="hidden" name="fabric_specification_id" value={specChoice} />
            <p className="text-sm"><b>{beam?.fabric_quality_name ?? L.beam.noQuality}</b> · {beam?.spec_code ?? L.beam.noSpec}</p>
            <p className="text-xs text-muted">{C.lockedQuality}</p>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={C.quality} htmlFor="fabric_quality_id" error={err.fabric_quality_id}>
              <select id="fabric_quality_id" name="fabric_quality_id" value={qualityId} onChange={(e) => pickQuality(e.target.value)} className={inputClass}>
                <option value="">{C.notSet}</option>
                {qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            </Field>
            <Field label={C.spec} htmlFor="fabric_specification_id" error={err.fabric_specification_id} hint={isNew ? C.specNewHint : undefined}>
              <select id="fabric_specification_id" name="fabric_specification_id" value={specChoice} onChange={(e) => setSpecChoice(e.target.value)}
                disabled={!qualityId} className={inputClass}>
                <option value="">{C.specNone}</option>
                {ownSpecs.map((s) => (
                  <option key={s.id} value={s.id}>{s.spec_code} — {L.spec.summary(str(s.reed) || L.spec.notSet, str(s.ends_per_inch) || L.spec.notSet)}</option>
                ))}
                <option value="new">{C.specNew}</option>
              </select>
            </Field>
          </div>
        )}
      </Section>

      <Section n={3} title={C.sWarpWeft}>
        {spec && !isNew ? (
          <>
            <p className="text-xs font-semibold text-muted">{C.specFromChosen(spec.spec_code)}</p>
            <SpecDetails spec={spec} />
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {yarn('warp_yarn_quality_id', C.warp, beam?.card_warp_yarn_quality_id)}
            {num('reed', C.reed, beam?.card_reed)}
            {isNew && num('spec_epi', C.epi, null)}
            {yarn('weft_yarn_quality_id', C.weft, beam?.card_weft_yarn_quality_id)}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {num('total_ends', C.totalEnds, beam?.total_ends, { mode: 'numeric' })}
          {num('reed_space_in', C.reedSpace, beam?.reed_space_in)}
        </div>
      </Section>

      <Section n={4} title={C.sMeasure}>
        <div className="grid grid-cols-2 gap-3">
          {num('warp_length_m', C.counterMeter, beam?.warp_length_m)}
          {num('rolling_meter', C.rollingMeter, beam?.rolling_meter)}
          {num('warp_weight_kg', C.warpWeight, beam?.warp_weight_kg)}
          {num('weft_weight_kg', C.weftWeight, beam?.weft_weight_kg)}
          {num('gross_weight_kg', C.gw, beam?.gross_weight_kg)}
          {num('finished_weight_kg', C.fw, beam?.finished_weight_kg)}
        </div>
      </Section>

      <Section n={5} title={C.sWeaving}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={C.weave} htmlFor="weave" error={err.weave}>
            <input {...fieldProps('weave', state, str(beam?.weave))} placeholder={C.weavePlaceholder} autoComplete="off" className={inputClass} />
          </Field>
          {num('picks_on_loom', C.picks, beam?.picks_on_loom)}
        </div>
      </Section>

      <Section n={6} title={C.sDates}>
        <div className="grid gap-3 sm:grid-cols-3">
          {date('getting_date', C.gettingDate, beam?.getting_date)}
          {date('expected_finish_date', C.finishExpected, beam?.expected_finish_date)}
          {date('actual_finish_date', C.finishActual, beam?.actual_finish_date)}
        </div>
      </Section>

      <Section n={7} title={C.sLoom}>
        {onLoom || finished ? (
          <p className="text-sm" data-testid="card-loom">
            {onLoom ? L.beam.onLoom(beam?.machine_no ?? '') : `${L.beam.statuses.finished} · ${beam?.machine_no ?? ''}`}
          </p>
        ) : (
          <>
            <Field label={C.loom} htmlFor="loom_id" error={err.loom_id}>
              <select id="loom_id" name="loom_id" value={loomId} onChange={(e) => setLoomId(e.target.value)} className={inputClass}>
                <option value="">{C.loomNone}</option>
                {[...new Set(looms.map((l) => l.factory_code))].map((f) => [f, looms.filter((l) => l.factory_code === f)] as const).map(([f, ls]) => (
                  <optgroup key={f} label={f}>
                    {ls.map((l) => (
                      <option key={l.loom_id} value={l.loom_id} disabled={l.status === 'maintenance'}>
                        {l.machine_no} — {l.beam_id ? C.loomBusy(l.beam_no ?? '') : l.status === 'maintenance' ? L.loom.statuses.maintenance : C.loomFree}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            {busyWith && (
              <div role="radiogroup" aria-label={C.replaceQ(loom!.machine_no, busyWith)} className="space-y-2 rounded-lg border border-warn bg-warn-soft p-3 text-sm">
                <p className="font-semibold">{C.replaceQ(loom!.machine_no, busyWith)}</p>
                {(canUnload ? (['finish', 'unload'] as const) : (['finish'] as const)).map((r) => (
                  <label key={r} className="flex min-h-10 items-start gap-2">
                    <input type="radio" name="replace" value={r} defaultChecked={sv?.replace === r} className="mt-1 size-4 accent-brand" />
                    <span>{r === 'finish' ? C.replaceFinish(busyWith) : C.replaceUnload(busyWith)}</span>
                  </label>
                ))}
                {err.replace && <p className="font-medium text-bad">{err.replace}</p>}
              </div>
            )}
            {!loomId && (fixedFactoryId ? (
              <input type="hidden" name="factory_id" value={fixedFactoryId} />
            ) : (
              <Field label={C.factory} htmlFor="factory_id" error={err.factory_id} hint={C.factoryHint}>
                <select {...fieldProps('factory_id', state, str(beam?.factory_id))} className={inputClass}>
                  <option value="">{C.factoryNone}</option>
                  {factories.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
                </select>
              </Field>
            ))}
          </>
        )}
      </Section>

      <Field label={L.beam.notes} htmlFor="notes" optional>
        <textarea {...fieldProps('notes', state, str(beam?.notes))} rows={2} className={`${inputClass} py-2`} />
      </Field>
      <SubmitButton className="w-full">{loomId && !onLoom && !finished ? C.saveAndLoad : C.save}</SubmitButton>
    </form>
  );
}

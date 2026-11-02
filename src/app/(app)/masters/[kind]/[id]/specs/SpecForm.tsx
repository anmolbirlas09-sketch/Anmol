'use client';

import { useActionState } from 'react';
import { Combobox } from '@/components/Combobox';
import { SubmitButton, fieldProps, formKey } from '@/components/form';
import { Field, Notice, inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { FabricSpecification, YarnQuality } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { saveSpecificationAction } from '../../../actions';

const S = L.spec;

/**
 * Reed and Total Ends per Inch are two separate inputs. Neither is calculated
 * from the other; both can be changed independently.
 */
export function SpecForm({
  qualityId, spec, yarnQualities, defaults,
}: {
  qualityId: string;
  spec: FabricSpecification | null;
  yarnQualities: YarnQuality[];
  defaults: { warp_yarn_quality_id?: string | null; weft_yarn_quality_id?: string | null };
}) {
  const save = saveSpecificationAction.bind(null, qualityId, spec?.id ?? null);
  const initial: Record<string, string> = {
    reed: spec?.reed != null ? String(spec.reed) : '',
    ends_per_inch: spec?.ends_per_inch != null ? String(spec.ends_per_inch) : '',
    warp_yarn_quality_id: spec?.warp_yarn_quality_id ?? defaults.warp_yarn_quality_id ?? '',
    weft_yarn_quality_id: spec?.weft_yarn_quality_id ?? defaults.weft_yarn_quality_id ?? '',
    notes: spec?.notes ?? '',
    active: spec ? (spec.active ? 'on' : '') : 'on',
  };
  const [state, action] = useActionState(save, { values: initial } as FormState);
  const v = state.values ?? initial;
  const err = state.fieldErrors ?? {};
  // With history, a field is locked once it has a value (blank ones may be filled in once).
  const locked = (field: 'reed' | 'ends_per_inch' | 'warp_yarn_quality_id' | 'weft_yarn_quality_id') =>
    Boolean(spec?.has_history && spec[field] != null);
  const yarnOptions = yarnQualities.map((q) => ({ value: q.id, label: q.name, detail: q.denier ? `${q.denier} D` : undefined }));

  return (
    <form key={formKey(state)} action={action} className="space-y-4" noValidate>
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      {spec?.has_history && <Notice tone="neutral">{S.locked} {S.lockedBlankOk}</Notice>}
      <input type="hidden" name="fabric_quality_id" value={qualityId} />

      <div className="rounded-lg bg-sunken px-3 py-2 text-sm">
        <span className="text-muted">{S.id}: </span>
        <span className="font-bold" data-testid="spec-code">{spec?.spec_code ?? S.idAuto}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label={S.reed} htmlFor="reed" error={err.reed}>
          <input {...fieldProps('reed', state)} defaultValue={v.reed} inputMode="decimal" autoComplete="off" readOnly={locked('reed')} className={`${inputClass} tnum text-lg font-semibold read-only:bg-sunken`} />
        </Field>
        <Field label={S.epi} htmlFor="ends_per_inch" error={err.ends_per_inch}>
          <input {...fieldProps('ends_per_inch', state)} defaultValue={v.ends_per_inch} inputMode="decimal" autoComplete="off" readOnly={locked('ends_per_inch')} className={`${inputClass} tnum text-lg font-semibold read-only:bg-sunken`} />
        </Field>
      </div>

      <Field label={S.warp} htmlFor="warp_yarn_quality_id" error={err.warp_yarn_quality_id}>
        {locked('warp_yarn_quality_id') ? (
          <>
            <input type="hidden" name="warp_yarn_quality_id" value={v.warp_yarn_quality_id} />
            <div className={`${inputClass} flex items-center bg-sunken`}>{spec?.warp_yarn_quality_name}</div>
          </>
        ) : (
          <Combobox id="warp_yarn_quality_id" name="warp_yarn_quality_id" defaultValue={v.warp_yarn_quality_id} options={yarnOptions} invalid={Boolean(err.warp_yarn_quality_id)} />
        )}
      </Field>
      <Field label={S.weft} htmlFor="weft_yarn_quality_id" error={err.weft_yarn_quality_id}>
        {locked('weft_yarn_quality_id') ? (
          <>
            <input type="hidden" name="weft_yarn_quality_id" value={v.weft_yarn_quality_id} />
            <div className={`${inputClass} flex items-center bg-sunken`}>{spec?.weft_yarn_quality_name}</div>
          </>
        ) : (
          <Combobox id="weft_yarn_quality_id" name="weft_yarn_quality_id" defaultValue={v.weft_yarn_quality_id} options={yarnOptions} invalid={Boolean(err.weft_yarn_quality_id)} />
        )}
      </Field>

      <Field label={L.masters.notes} htmlFor="notes" optional>
        <textarea {...fieldProps('notes', state)} defaultValue={v.notes} rows={2} className={`${inputClass} py-2`} />
      </Field>
      <label className="flex min-h-12 items-start gap-3 font-semibold">
        <input type="checkbox" name="active" defaultChecked={v.active === 'on'} className="mt-0.5 size-5 accent-brand" />
        <span>
          {L.masters.active}
          <span className="block text-sm font-normal text-muted">{S.deactivateHint}</span>
        </span>
      </label>
      <SubmitButton className="w-full">{L.app.save}</SubmitButton>
    </form>
  );
}

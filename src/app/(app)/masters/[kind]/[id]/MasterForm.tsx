'use client';

import { useActionState } from 'react';
import { Combobox } from '@/components/Combobox';
import { SubmitButton, fieldProps, formKey } from '@/components/form';
import { Field, Notice, inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { YarnQuality } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { saveMasterAction } from '../../actions';
import type { MasterKind } from '../../config';

type Initial = Record<string, string | number | boolean | null | undefined>;

const toStrings = (o: Initial) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'on' : '') : String(v)]));

export function MasterForm({ kind, id, initial, yarnQualities = [] }: { kind: MasterKind; id: string | null; initial: Initial; yarnQualities?: YarnQuality[] }) {
  const save = saveMasterAction.bind(null, kind, id);
  const [state, action] = useActionState(save, { values: toStrings(initial) } as FormState);
  const err = state.fieldErrors ?? {};
  const text = (name: string, label: string, opts: { optional?: boolean; decimal?: boolean; className?: string } = {}) => (
    <Field label={label} htmlFor={name} error={err[name]} optional={opts.optional} className={opts.className}>
      <input {...fieldProps(name, state)} inputMode={opts.decimal ? 'decimal' : undefined} autoComplete="off" className={inputClass} />
    </Field>
  );
  const yarnOptions = yarnQualities.map((q) => ({ value: q.id, label: q.name, detail: q.denier ? `${q.denier} D` : undefined }));

  return (
    <form key={formKey(state)} action={action} className="space-y-4" noValidate>
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      {text('name', L.masters.name)}

      {kind === 'yarn-qualities' && (
        <div className="grid grid-cols-2 gap-4">
          {text('denier', L.masters.denier, { optional: true, decimal: true })}
          {text('reorder_level_kg', L.masters.reorderLevel, { decimal: true })}
          {text('material', L.masters.material, { optional: true })}
          {text('color', L.masters.color, { optional: true })}
        </div>
      )}

      {kind === 'fabric-qualities' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={L.masters.warpYarn} htmlFor="warp_yarn_quality_id" optional hint={L.spec.defaultYarnsHint}>
              <Combobox id="warp_yarn_quality_id" name="warp_yarn_quality_id" clearable defaultValue={state.values?.warp_yarn_quality_id} options={yarnOptions} />
            </Field>
            <Field label={L.masters.weftYarn} htmlFor="weft_yarn_quality_id" optional hint={L.spec.defaultYarnsHint}>
              <Combobox id="weft_yarn_quality_id" name="weft_yarn_quality_id" clearable defaultValue={state.values?.weft_yarn_quality_id} options={yarnOptions} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {text('total_ends', L.masters.totalEnds, { optional: true, decimal: true })}
            {text('reed_width_m', L.masters.reedWidth, { optional: true, decimal: true })}
            {text('picks_per_inch', L.masters.ppi, { optional: true, decimal: true })}
            {text('warp_crimp_pct', L.masters.warpCrimp, { decimal: true })}
            {text('weft_wastage_pct', L.masters.weftWastage, { decimal: true })}
            {text('gsm', L.masters.gsm, { optional: true, decimal: true })}
          </div>
        </>
      )}

      {kind === 'suppliers' && (
        <div className="grid gap-4 sm:grid-cols-3">
          {text('gstin', L.masters.gstin, { optional: true })}
          {text('contact', L.masters.contact, { optional: true })}
          {text('phone', L.masters.phone, { optional: true })}
        </div>
      )}

      {kind !== 'suppliers' && (
        <Field label={L.masters.notes} htmlFor="notes" optional>
          <textarea {...fieldProps('notes', state)} rows={2} className={`${inputClass} py-2`} />
        </Field>
      )}

      <label className="flex min-h-12 items-center gap-3 font-semibold">
        <input type="checkbox" name="active" defaultChecked={(state.values?.active ?? 'on') === 'on'} className="size-5 accent-brand" />
        {L.masters.active}
      </label>
      <SubmitButton className="w-full">{L.app.save}</SubmitButton>
    </form>
  );
}

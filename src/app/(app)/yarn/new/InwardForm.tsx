'use client';

import { useActionState } from 'react';
import { Combobox } from '@/components/Combobox';
import { SubmitButton, fieldProps, formKey } from '@/components/form';
import { Field, Notice, inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { Factory, Supplier, YarnQuality } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { createLotAction } from '../actions';

export function InwardForm({
  qualities, suppliers, factories, defaultFactoryId, today,
}: {
  qualities: YarnQuality[]; suppliers: Supplier[]; factories: Factory[]; defaultFactoryId?: string; today: string;
}) {
  const [state, action] = useActionState(createLotAction, {} as FormState);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};

  return (
    <form key={formKey(state)} action={action} className="space-y-4" noValidate>
      {state.error && <Notice tone="bad">{state.error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L.yarn.lotNo} htmlFor="lot_no" error={err.lot_no}>
          <input {...fieldProps('lot_no', state)} autoCapitalize="characters" autoComplete="off" className={inputClass} />
        </Field>
        <Field label={L.yarn.inwardDate} htmlFor="inward_date" error={err.inward_date}>
          <input {...fieldProps('inward_date', state, today)} type="date" max={today} className={inputClass} />
        </Field>
      </div>

      <Field label={L.yarn.quality} htmlFor="yarn_quality_id" error={err.yarn_quality_id}>
        <Combobox
          key={`q-${v.yarn_quality_id ?? ''}`}
          id="yarn_quality_id"
          name="yarn_quality_id"
          defaultValue={v.yarn_quality_id}
          invalid={Boolean(err.yarn_quality_id)}
          options={qualities.map((q) => ({ value: q.id, label: q.name, detail: q.denier ? `${q.denier} D` : undefined, keywords: `${q.color ?? ''} ${q.material ?? ''}` }))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L.yarn.kgsReceived} htmlFor="kgs_received" error={err.kgs_received}>
          <input {...fieldProps('kgs_received', state)} inputMode="decimal" autoComplete="off" className={`${inputClass} tnum text-lg font-semibold`} />
        </Field>
        <Field label={L.yarn.factory} htmlFor="factory_id" error={err.factory_id}>
          <select {...fieldProps('factory_id', state, defaultFactoryId ?? factories[0]?.id)} className={inputClass}>
            {factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={L.yarn.supplier} htmlFor="supplier_id" optional error={err.supplier_id}>
        <Combobox
          key={`s-${v.supplier_id ?? ''}`}
          id="supplier_id"
          name="supplier_id"
          clearable
          defaultValue={v.supplier_id}
          options={suppliers.map((s) => ({ value: s.id, label: s.name, detail: s.gstin ?? undefined }))}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label={L.yarn.challan} htmlFor="challan_no" optional className="col-span-2">
          <input {...fieldProps('challan_no', state)} autoComplete="off" className={inputClass} />
        </Field>
        <Field label={L.yarn.bags} htmlFor="bags_count" optional error={err.bags_count}>
          <input {...fieldProps('bags_count', state)} inputMode="numeric" className={inputClass} />
        </Field>
        <Field label={L.yarn.cones} htmlFor="cones_count" optional error={err.cones_count}>
          <input {...fieldProps('cones_count', state)} inputMode="numeric" className={inputClass} />
        </Field>
        <Field label={L.yarn.rate} htmlFor="rate_per_kg" optional error={err.rate_per_kg} className="col-span-2">
          <input {...fieldProps('rate_per_kg', state)} inputMode="decimal" className={inputClass} />
        </Field>
      </div>

      <Field label={L.yarn.notes} htmlFor="notes" optional>
        <textarea {...fieldProps('notes', state)} rows={2} className={`${inputClass} py-2`} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <SubmitButton className="w-full">{L.app.save}</SubmitButton>
        <SubmitButton variant="secondary" className="w-full" name="another">
          {L.app.save} + new
        </SubmitButton>
      </div>
    </form>
  );
}

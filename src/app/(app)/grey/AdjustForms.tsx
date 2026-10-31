'use client';

import { useActionState, useState } from 'react';
import { SubmitButton, fieldProps, formKey } from '@/components/form';
import { SpecPicker } from '@/components/SpecPicker';
import { Field, Notice, inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { Factory, FabricQualityView, FabricSpecification } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { greyAdjustAction, yarnAdjustAction } from './adjust-actions';

export function YarnAdjustForm({ lotId, today }: { lotId: string; today: string }) {
  const [state, action] = useActionState(yarnAdjustAction, {} as FormState);
  const s = state.ok ? {} : state; // clear the fields after a save
  return (
    <form action={action} className="space-y-3" noValidate key={formKey(state)}>
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <input type="hidden" name="yarn_lot_id" value={lotId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={L.adjust.kgs} htmlFor="kgs" error={s.fieldErrors?.kgs}>
          <input {...fieldProps('kgs', s)} inputMode="text" placeholder="-5" autoComplete="off" className={`${inputClass} tnum`} />
        </Field>
        <Field label={L.adjust.date} htmlFor="entry_date" error={s.fieldErrors?.entry_date}>
          <input {...fieldProps('entry_date', s, today)} type="date" max={today} className={inputClass} />
        </Field>
      </div>
      <Field label={L.adjust.reason} htmlFor="reason" error={s.fieldErrors?.reason} hint={L.adjust.reasonHint}>
        <input {...fieldProps('reason', s)} autoComplete="off" className={inputClass} />
      </Field>
      <SubmitButton variant="secondary" className="w-full">{L.adjust.save}</SubmitButton>
    </form>
  );
}

export function GreyAdjustForm({
  qualities, specs, factories, defaultFactoryId, today,
}: { qualities: FabricQualityView[]; specs: FabricSpecification[]; factories: Factory[]; defaultFactoryId?: string; today: string }) {
  const [state, action] = useActionState(greyAdjustAction, {} as FormState);
  const s = state.ok ? {} : state;
  const [qualityId, setQualityId] = useState(s.values?.fabric_quality_id ?? '');
  const [specId, setSpecId] = useState(s.values?.fabric_specification_id ?? '');
  return (
    <form action={action} className="space-y-3" noValidate key={formKey(state)}>
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <SpecPicker qualities={qualities} specs={specs} qualityId={qualityId} specId={specId} onQuality={setQualityId} onSpec={setSpecId} errors={s.fieldErrors} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={L.beam.factory} htmlFor="factory_id">
          <select {...fieldProps('factory_id', s, defaultFactoryId ?? factories[0]?.id)} className={inputClass}>
            {factories.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
          </select>
        </Field>
        <Field label={L.adjust.meters} htmlFor="meters" error={s.fieldErrors?.meters}>
          <input {...fieldProps('meters', s, '0')} autoComplete="off" className={`${inputClass} tnum`} />
        </Field>
        <Field label={L.adjust.kgs} htmlFor="kgs" error={s.fieldErrors?.kgs}>
          <input {...fieldProps('kgs', s, '0')} autoComplete="off" className={`${inputClass} tnum`} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={L.adjust.reason} htmlFor="reason" error={s.fieldErrors?.reason} className="col-span-2 sm:col-span-1">
          <input {...fieldProps('reason', s)} autoComplete="off" className={inputClass} />
        </Field>
        <Field label={L.adjust.date} htmlFor="entry_date" className="col-span-2 sm:col-span-1">
          <input {...fieldProps('entry_date', s, today)} type="date" max={today} className={inputClass} />
        </Field>
      </div>
      <SubmitButton className="w-full">{L.adjust.save}</SubmitButton>
    </form>
  );
}

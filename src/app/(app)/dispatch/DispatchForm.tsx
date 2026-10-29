'use client';

import { useActionState, useEffect, useState } from 'react';
import { Combobox } from '@/components/Combobox';
import { SubmitButton } from '@/components/form';
import { Field, Notice, inputClass } from '@/components/ui';
import { fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import type { Factory, GreyStockRow } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { dispatchAction } from './actions';

const num = (s: string) => Number(s.replace(/,/g, ''));

export function DispatchForm({ stock, factories, defaultFactoryId, today }: { stock: GreyStockRow[]; factories: Factory[]; defaultFactoryId?: string; today: string }) {
  const [state, action] = useActionState(dispatchAction, {} as FormState);
  const [factoryId, setFactoryId] = useState(state.values?.factory_id ?? defaultFactoryId ?? factories[0]?.id ?? '');
  const [qualityId, setQualityId] = useState('');
  const [meters, setMeters] = useState('');
  const [kgs, setKgs] = useState('');

  useEffect(() => {
    if (state.ok) {
      setQualityId('');
      setMeters('');
      setKgs('');
    } else if (state.values) {
      setMeters(state.values.meters ?? '');
      setKgs(state.values.kgs ?? '');
      setQualityId(state.values.fabric_quality_id ?? '');
    }
  }, [state]);

  const atFactory = stock.filter((s) => s.factory_id === factoryId && (s.stock_m > 0 || s.stock_kg > 0));
  const row = atFactory.find((s) => s.fabric_quality_id === qualityId);
  const over = row && ((num(meters) > 0 && num(meters) > row.stock_m + 1e-9) || (num(kgs) > 0 && num(kgs) > row.stock_kg + 1e-9));
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.ok && state.message && <Notice tone="ok">{state.message}</Notice>}
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <input type="hidden" name="quality_name" value={row?.fabric_quality_name ?? ''} />

      <div className="grid grid-cols-2 gap-4">
        <Field label={L.dispatch.factory} htmlFor="factory_id" error={err.factory_id}>
          <select id="factory_id" name="factory_id" value={factoryId} onChange={(e) => { setFactoryId(e.target.value); setQualityId(''); }} className={inputClass}>
            {factories.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
          </select>
        </Field>
        <Field label={L.dispatch.date} htmlFor="entry_date" error={err.entry_date}>
          <input key={state.values?.entry_date ?? today} id="entry_date" name="entry_date" type="date" max={today} defaultValue={state.values?.entry_date ?? today} className={inputClass} />
        </Field>
      </div>

      {atFactory.length === 0 ? (
        <Notice tone="warn">{L.dispatch.noStock}</Notice>
      ) : (
        <Field label={L.dispatch.fabricQuality} htmlFor="fabric_quality_id" error={err.fabric_quality_id}
          hint={row ? L.dispatch.inStock(fmtM(row.stock_m), fmtKg(row.stock_kg)) : undefined}>
          <Combobox
            key={factoryId}
            id="fabric_quality_id"
            name="fabric_quality_id"
            value={qualityId}
            onChange={setQualityId}
            invalid={Boolean(err.fabric_quality_id)}
            options={atFactory.map((s) => ({ value: s.fabric_quality_id, label: s.fabric_quality_name, detail: `${fmtM(s.stock_m)} m` }))}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label={L.dispatch.meters} htmlFor="meters" error={err.meters}>
          <input id="meters" name="meters" value={meters} onChange={(e) => setMeters(e.target.value)} inputMode="decimal" autoComplete="off" className={`${inputClass} tnum text-lg font-semibold`} />
        </Field>
        <Field label={L.dispatch.kgs} htmlFor="kgs" error={err.kgs}>
          <input id="kgs" name="kgs" value={kgs} onChange={(e) => setKgs(e.target.value)} inputMode="decimal" autoComplete="off" className={`${inputClass} tnum text-lg font-semibold`} />
        </Field>
      </div>
      {over && <Notice tone="bad">{L.dispatch.overStock}</Notice>}

      <Field label={L.dispatch.party} htmlFor="party" optional>
        <input key={`p-${state.values?.party ?? ''}`} id="party" name="party" defaultValue={state.values?.party} autoComplete="off" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={L.dispatch.challan} htmlFor="challan_no" optional>
          <input key={`c-${state.ok ? state.message : ''}`} id="challan_no" name="challan_no" defaultValue={state.ok ? '' : state.values?.challan_no} autoComplete="off" className={inputClass} />
        </Field>
        <Field label={L.dispatch.rolls} htmlFor="roll_refs" optional>
          <input key={`r-${state.ok ? state.message : ''}`} id="roll_refs" name="roll_refs" defaultValue={state.ok ? '' : state.values?.roll_refs} autoComplete="off" className={inputClass} />
        </Field>
      </div>
      <SubmitButton className="w-full" disabled={!row || Boolean(over)}>{L.dispatch.save}</SubmitButton>
    </form>
  );
}

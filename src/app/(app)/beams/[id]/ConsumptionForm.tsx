'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { Combobox, type ComboOption } from '@/components/Combobox';
import { SubmitButton } from '@/components/form';
import { Field, Notice, cx, inputClass } from '@/components/ui';
import { fmtKg } from '@/lib/format';
import { L } from '@/lib/labels';
import type { UsageType, YarnLotBalance } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { addConsumptionAction, lotAvailableAction } from '../actions';

interface Props {
  beamId: string;
  lots: YarnLotBalance[];
  expected: Record<UsageType, { id: string | null; name: string | null }>;
  today: string;
}

export function ConsumptionForm({ beamId, lots, expected, today }: Props) {
  const [state, action] = useActionState(addConsumptionAction, {} as FormState);
  const [usage, setUsage] = useState<UsageType>('warp');
  const [lotId, setLotId] = useState('');
  const [kg, setKg] = useState('');
  const [available, setAvailable] = useState<number | null>(null);
  const [checking, startCheck] = useTransition();

  // After a successful save: keep usage + date, clear lot and kg for the next line.
  useEffect(() => {
    if (state.ok) {
      setLotId('');
      setKg('');
      setAvailable(null);
    } else if (state.values) {
      setKg(state.values.kgs ?? '');
      if (state.values.yarn_lot_id) refreshAvailable(state.values.yarn_lot_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function refreshAvailable(id: string) {
    const fromList = lots.find((l) => l.yarn_lot_id === id);
    setAvailable(fromList ? Number(fromList.balance_kg) : null);
    startCheck(async () => setAvailable(await lotAvailableAction(id)));
  }

  const want = expected[usage];
  const options: ComboOption[] = useMemo(() => {
    const opt = (l: YarnLotBalance, group: string): ComboOption => ({
      value: l.yarn_lot_id,
      label: `${l.lot_no} · ${l.yarn_quality_name}`,
      detail: `${fmtKg(l.balance_kg)} kg`,
      group,
      keywords: `${l.factory_code} ${l.supplier_name ?? ''}`,
    });
    if (!want.id) return lots.map((l) => opt(l, L.beam.otherLots));
    const match = lots.filter((l) => l.yarn_quality_id === want.id);
    const rest = lots.filter((l) => l.yarn_quality_id !== want.id);
    return [...match.map((l) => opt(l, L.beam.recommended(want.name ?? ''))), ...rest.map((l) => opt(l, L.beam.otherLots))];
  }, [lots, want.id, want.name]);

  const lot = lots.find((l) => l.yarn_lot_id === lotId);
  const mismatch = lot && want.id && lot.yarn_quality_id !== want.id;
  const kgNum = Number(kg.replace(/,/g, ''));
  const over = available != null && kgNum > 0 && kgNum > available + 1e-9;
  // The server's answer wins while the kg typed is the one it rejected.
  const serverKgError = state.fieldErrors?.kgs && state.values?.kgs === kg ? state.fieldErrors.kgs : undefined;
  const kgError = serverKgError ?? (over ? L.beam.moreThanAvailable(fmtKg(available)) : undefined);

  if (lots.length === 0) return <Notice tone="warn">{L.beam.noOpenLots}</Notice>;

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="beam_id" value={beamId} />
      {state.ok && state.message && <Notice tone="ok">{state.message}</Notice>}

      <fieldset>
        <legend className="mb-1 text-sm font-semibold">{L.beam.usage}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['warp', 'weft'] as const).map((u) => (
            <label
              key={u}
              className={cx(
                'flex min-h-12 cursor-pointer items-center justify-center rounded-lg border text-base font-semibold',
                usage === u ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface',
              )}
            >
              <input type="radio" name="usage_type" value={u} checked={usage === u} onChange={() => setUsage(u)} className="sr-only" />
              {u === 'warp' ? L.beam.warp : L.beam.weft}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={L.beam.lot} htmlFor="yarn_lot_id" error={state.fieldErrors?.yarn_lot_id}>
        <Combobox
          id="yarn_lot_id"
          name="yarn_lot_id"
          value={lotId}
          onChange={(v) => {
            setLotId(v);
            refreshAvailable(v);
          }}
          options={options}
          invalid={Boolean(state.fieldErrors?.yarn_lot_id)}
        />
      </Field>
      {mismatch && <Notice tone="warn">{L.beam.qualityMismatch(lot.yarn_quality_name, want.name ?? '')}</Notice>}

      <div className="grid grid-cols-2 gap-4">
        <Field
          label={L.beam.kgs}
          htmlFor="kgs"
          error={kgError}
          hint={lotId && available != null ? (checking ? L.app.loading : L.beam.availableKg(fmtKg(available))) : undefined}
        >
          <input
            id="kgs"
            name="kgs"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={kgError ? true : undefined}
            aria-describedby={kgError ? 'kgs-error' : undefined}
            className={`${inputClass} tnum text-lg font-semibold`}
          />
        </Field>
        <Field label={L.beam.entryDate} htmlFor="entry_date" error={state.fieldErrors?.entry_date}>
          <input
            key={state.values?.entry_date ?? today}
            id="entry_date"
            name="entry_date"
            type="date"
            max={today}
            defaultValue={state.values?.entry_date ?? today}
            className={inputClass}
          />
        </Field>
      </div>

      <SubmitButton className="w-full" disabled={over}>
        {L.beam.addConsumption}
      </SubmitButton>
    </form>
  );
}

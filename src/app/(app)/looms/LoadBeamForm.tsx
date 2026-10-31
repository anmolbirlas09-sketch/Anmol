'use client';

import { useActionState, useState } from 'react';
import { Combobox, type ComboOption } from '@/components/Combobox';
import { SubmitButton } from '@/components/form';
import { Field, Notice } from '@/components/ui';
import { fmtDate, fmtKg } from '@/lib/format';
import { L } from '@/lib/labels';
import type { BeamSummary, LoomStatusRow } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { loadBeamAction } from './actions';

interface Props {
  beams: BeamSummary[];
  /** Looms the user may load; a busy one asks what happens to its running beam. */
  looms: LoomStatusRow[];
  fixedBeam?: BeamSummary;
  fixedLoom?: LoomStatusRow;
  defaultBeamId?: string;
  defaultLoomId?: string;
  /** Owner / supervisor: may take the running beam off unfinished. */
  canUnload?: boolean;
}

/** Pick a beam that is not on a loom and a loom. Either side can be fixed by the page. */
export function LoadBeamForm({ beams, looms, fixedBeam, fixedLoom, defaultBeamId, defaultLoomId, canUnload }: Props) {
  const [state, action] = useActionState(loadBeamAction, {} as FormState);
  const [beamId, setBeamId] = useState(fixedBeam?.beam_id ?? state.values?.beam_id ?? defaultBeamId ?? '');
  const [loomId, setLoomId] = useState(fixedLoom?.loom_id ?? state.values?.loom_id ?? defaultLoomId ?? '');
  const beam = fixedBeam ?? beams.find((b) => b.beam_id === beamId);
  const loom = fixedLoom ?? looms.find((l) => l.loom_id === loomId);
  const running = loom?.beam_id ? loom.beam_no : null;

  // Looms at the beam's factory first, then the rest.
  const homeFactory = beam?.factory_code;
  const loomOptions: ComboOption[] = [...looms]
    .sort((a, b) => Number(b.factory_code === homeFactory) - Number(a.factory_code === homeFactory))
    .map((l) => ({
      value: l.loom_id,
      label: l.machine_no,
      detail: [l.factory_code, l.assigned_spec_code, l.beam_id ? L.card.loomBusy(l.beam_no ?? '') : L.card.loomFree].filter(Boolean).join(' · '),
      group: homeFactory && l.factory_code !== homeFactory ? L.loom.otherFactory : L.loom.sameFactoryFirst(l.factory_code),
    }));
  const beamOptions: ComboOption[] = beams.map((b) => ({
    value: b.beam_id,
    label: [b.beam_no, b.fabric_quality_name, b.spec_code].filter(Boolean).join(' · '),
    detail: b.factory_code ?? undefined,
    keywords: `${fmtDate(b.created_date)} CARD-${b.card_no}`,
  }));

  if (!fixedBeam && beams.length === 0) return <Notice tone="warn">{L.loom.noPrepared}</Notice>;
  if (!fixedLoom && looms.length === 0) return <Notice tone="warn">{L.loom.noFreeLooms}</Notice>;

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      {fixedBeam ? (
        <input type="hidden" name="beam_id" value={fixedBeam.beam_id} />
      ) : (
        <Field label={L.loom.pickBeam} htmlFor="beam_id" error={state.fieldErrors?.beam_id}>
          <Combobox id="beam_id" name="beam_id" value={beamId} onChange={setBeamId} options={beamOptions} invalid={Boolean(state.fieldErrors?.beam_id)} />
        </Field>
      )}
      {beam && !fixedBeam && (
        <p className="tnum -mt-2 text-sm text-muted">
          {L.beam.warp} {fmtKg(beam.warp_kg)} kg · {L.beam.weft} {fmtKg(beam.weft_kg)} kg
        </p>
      )}
      {fixedLoom ? (
        <input type="hidden" name="loom_id" value={fixedLoom.loom_id} />
      ) : (
        <Field label={L.loom.pickLoom} htmlFor="loom_id" error={state.fieldErrors?.loom_id}>
          <Combobox
            key={homeFactory ?? 'none'}
            id="loom_id"
            name="loom_id"
            value={loomId}
            onChange={setLoomId}
            options={loomOptions}
            invalid={Boolean(state.fieldErrors?.loom_id)}
          />
        </Field>
      )}
      {running && loom && (
        <div role="radiogroup" aria-label={L.card.replaceQ(loom.machine_no, running)} className="space-y-2 rounded-lg border border-warn bg-warn-soft p-3 text-sm">
          <p className="font-semibold">{L.card.replaceQ(loom.machine_no, running)}</p>
          {(canUnload ? (['finish', 'unload'] as const) : (['finish'] as const)).map((r) => (
            <label key={r} className="flex min-h-10 items-start gap-2">
              <input type="radio" name="replace" value={r} defaultChecked={state.values?.replace === r} className="mt-1 size-4 accent-brand" />
              <span>{r === 'finish' ? L.card.replaceFinish(running) : L.card.replaceUnload(running)}</span>
            </label>
          ))}
          {state.fieldErrors?.replace && <p className="font-medium text-bad">{state.fieldErrors.replace}</p>}
        </div>
      )}
      <SubmitButton pendingText={L.loom.loading} className="w-full">
        {L.loom.load}
      </SubmitButton>
    </form>
  );
}

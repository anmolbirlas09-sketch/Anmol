'use client';

import { useActionState } from 'react';
import { SubmitButton, fieldProps, formKey } from '@/components/form';
import { Field, Notice, cx, inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { AppUser, Factory, FabricSpecification, LoomRow } from '@/lib/types';
import type { FormState } from '@/lib/validation';
import { saveFactoryAction, saveLoomAction, saveSettingsAction, saveUserAction } from './actions';

const small = cx(inputClass, 'min-h-11');

function Status({ state }: { state: FormState }) {
  if (state.error) return <Notice tone="bad">{state.error}</Notice>;
  const first = state.fieldErrors && Object.values(state.fieldErrors)[0];
  if (first) return <Notice tone="bad">{first}</Notice>;
  if (state.ok) return <Notice tone="ok">{state.message}</Notice>;
  return null;
}

const check = (v: boolean | string | undefined) => v === true || v === 'on';

export function UserForm({ user, factories, isMe }: { user: AppUser; factories: Factory[]; isMe: boolean }) {
  const [state, action] = useActionState(saveUserAction, {} as FormState);
  const v = state.values;
  return (
    <form key={formKey(state)} action={action} className="space-y-3" aria-label={user.email ?? user.name}>
      <input type="hidden" name="id" value={user.id} />
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm font-semibold sm:col-span-2">
          {L.settings.name}
          <input name="name" defaultValue={v?.name ?? user.name} className={cx(small, 'mt-1 font-normal')} />
        </label>
        <label className="text-sm font-semibold">
          {L.settings.role}
          <select name="role" defaultValue={v?.role ?? user.role} disabled={isMe} className={cx(small, 'mt-1 font-normal')}>
            {(['owner', 'supervisor', 'data_entry'] as const).map((r) => <option key={r} value={r}>{L.roles[r]}</option>)}
          </select>
          {isMe && <input type="hidden" name="role" value="owner" />}
        </label>
        <label className="text-sm font-semibold">
          {L.settings.factory}
          <select name="factory_id" defaultValue={v?.factory_id ?? user.factory_id ?? ''} className={cx(small, 'mt-1 font-normal')}>
            <option value="">{L.settings.allFactories}</option>
            {factories.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 font-semibold">
          <input type="checkbox" name="active" defaultChecked={v ? check(v.active) : user.active} disabled={isMe} className="size-5 accent-brand" />
          {L.settings.active}
          {isMe && <input type="hidden" name="active" value="on" />}
        </label>
        <SubmitButton variant="secondary" className="min-h-11">{L.settings.save}</SubmitButton>
      </div>
      <Status state={state} />
    </form>
  );
}

export function LoomForm({ loom, factories, specs = [] }: { loom: LoomRow | null; factories: Factory[]; specs?: FabricSpecification[] }) {
  const save = saveLoomAction.bind(null, loom?.id ?? null);
  const [state, action] = useActionState(save, {} as FormState);
  const running = loom?.status === 'running';
  const v = state.values;
  return (
    <form key={formKey(state)} action={action} className="grid grid-cols-6 items-end gap-2" aria-label={loom?.machine_no ?? L.settings.addLoom}>
      <label className="col-span-2 text-xs font-semibold">
        {L.settings.machineNo}
        <input name="machine_no" defaultValue={v?.machine_no ?? loom?.machine_no ?? ''} className={cx(small, 'mt-1 font-normal')} />
      </label>
      {loom ? (
        <input type="hidden" name="factory_id" value={loom.factory_id} />
      ) : (
        <label className="col-span-2 text-xs font-semibold">
          {L.settings.factory}
          <select name="factory_id" defaultValue={v?.factory_id ?? factories[0]?.id} className={cx(small, 'mt-1 font-normal')}>
            {factories.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
          </select>
        </label>
      )}
      <label className={cx('text-xs font-semibold', loom ? 'col-span-2' : 'col-span-1')}>
        {loom ? L.settings.status : L.settings.sortOrder}
        {loom ? (
          running ? (
            <span className="mt-1 flex min-h-11 items-center text-xs font-normal text-muted">{L.settings.runningLocked}</span>
          ) : (
            <select name="status" defaultValue={v?.status ?? loom.status} className={cx(small, 'mt-1 font-normal')}>
              <option value="idle">{L.loom.statuses.idle}</option>
              <option value="maintenance">{L.loom.statuses.maintenance}</option>
            </select>
          )
        ) : (
          <input name="sort_order" inputMode="numeric" defaultValue={v?.sort_order ?? ''} className={cx(small, 'mt-1 font-normal')} />
        )}
      </label>
      <label className="col-span-1 flex min-h-11 items-center gap-1.5 text-xs font-semibold">
        <input type="checkbox" name="active" defaultChecked={v ? check(v.active) : (loom?.active ?? true)} disabled={running} className="size-5 accent-brand" />
        {L.settings.active}
        {running && <input type="hidden" name="active" value="on" />}
      </label>
      <SubmitButton variant={loom ? 'secondary' : 'primary'} className="col-span-1 min-h-11 px-2 text-sm">
        {loom ? L.settings.save : L.app.add}
      </SubmitButton>
      {loom && (
        <label className="col-span-6 text-xs font-semibold">
          {L.spec.loomAssigned}
          <select name="fabric_specification_id" defaultValue={v?.fabric_specification_id ?? loom.fabric_specification_id ?? ''} disabled={running} className={cx(small, 'mt-1 font-normal')}>
            <option value="">{L.spec.loomAny}</option>
            {specs.filter((s) => s.active || s.id === loom.fabric_specification_id).map((s) => (
              <option key={s.id} value={s.id}>{s.fabric_quality_name} · {s.spec_code}</option>
            ))}
          </select>
          {running && <input type="hidden" name="fabric_specification_id" value={loom.fabric_specification_id ?? ''} />}
        </label>
      )}
      <div className="col-span-6 empty:hidden"><Status state={state} /></div>
    </form>
  );
}

export function FactoryForm({ factory }: { factory: (Factory & { active: boolean }) | null }) {
  const save = saveFactoryAction.bind(null, factory?.id ?? null);
  const [state, action] = useActionState(save, {} as FormState);
  const v = state.values;
  return (
    <form key={formKey(state)} action={action} className="space-y-2" aria-label={factory?.code ?? L.settings.addFactory}>
      <div className="grid grid-cols-3 items-end gap-2">
        <label className="text-sm font-semibold">
          {L.settings.code}
          <input name="code" defaultValue={v?.code ?? factory?.code ?? ''} className={cx(small, 'mt-1 font-normal')} />
        </label>
        <label className="text-sm font-semibold">
          {L.settings.name}
          <input name="name" defaultValue={v?.name ?? factory?.name ?? ''} className={cx(small, 'mt-1 font-normal')} />
        </label>
        <div className="flex items-center gap-2">
          <label className="flex min-h-11 items-center gap-1.5 text-sm font-semibold">
            <input type="checkbox" name="active" defaultChecked={v ? check(v.active) : (factory?.active ?? true)} className="size-5 accent-brand" />
            {L.settings.active}
          </label>
          <SubmitButton variant={factory ? 'secondary' : 'primary'} className="min-h-11 flex-1 px-2">{factory ? L.settings.save : L.app.add}</SubmitButton>
        </div>
      </div>
      <Status state={state} />
    </form>
  );
}

export function GeneralForm({ threshold }: { threshold: number }) {
  const [state, action] = useActionState(saveSettingsAction, { values: { variance_threshold_pct: String(threshold) } } as FormState);
  return (
    <form key={formKey(state)} action={action} className="space-y-3">
      <Field label={L.settings.threshold} htmlFor="variance_threshold_pct" error={state.fieldErrors?.variance_threshold_pct}>
        <input {...fieldProps('variance_threshold_pct', state)} inputMode="decimal" className={inputClass} />
      </Field>
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <SubmitButton className="w-full">{L.settings.save}</SubmitButton>
    </form>
  );
}

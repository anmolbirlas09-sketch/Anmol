'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createDispatch, deleteDispatch } from '@/lib/data/dispatch';
import { friendlyError, notAllowed } from '@/lib/errors';
import { fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { dispatchSchema, formValues, parseForm, type FormState } from '@/lib/validation';

export async function dispatchAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(dispatchSchema, form);
  if (parsed.error) return parsed.error;
  try {
    await createDispatch(await createClient(), parsed.data);
  } catch (e) {
    return { error: friendlyError(e), values: formValues(form) };
  }
  for (const p of ['/', '/grey', '/dispatch']) revalidatePath(p);
  const d = parsed.data;
  return {
    ok: true,
    message: L.dispatch.saved(fmtM(d.meters), fmtKg(d.kgs), String(form.get('quality_name') ?? '')),
    values: { factory_id: d.factory_id, entry_date: d.entry_date, party: d.party ?? '' },
  };
}

export async function deleteDispatchAction(form: FormData): Promise<void> {
  let error: string | null = null;
  try {
    if (!(await deleteDispatch(await createClient(), String(form.get('id') ?? '')))) throw notAllowed();
  } catch (e) {
    error = friendlyError(e);
  }
  for (const p of ['/', '/grey', '/dispatch']) revalidatePath(p);
  redirect(error ? `/dispatch?error=${encodeURIComponent(error)}` : '/dispatch');
}

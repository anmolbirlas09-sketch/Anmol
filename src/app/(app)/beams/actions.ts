'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addConsumption, createBeam, deleteConsumption } from '@/lib/data/beams';
import { getLotBalance } from '@/lib/data/yarn';
import { friendlyError } from '@/lib/errors';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { beamSchema, consumptionSchema, formValues, parseForm, type FormState } from '@/lib/validation';

export async function createBeamAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(beamSchema, form);
  if (parsed.error) return parsed.error;
  let beam: { id: string; beam_no: string };
  try {
    beam = await createBeam(await createClient(), parsed.data);
  } catch (e) {
    const error = friendlyError(e);
    const field = error.includes('beam no') ? { beam_no: error } : undefined;
    return { error: field ? undefined : error, fieldErrors: field, values: formValues(form) };
  }
  revalidatePath('/beams');
  revalidatePath('/');
  redirect(`/beams/${beam.id}?created=1`);
}

export async function addConsumptionAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(consumptionSchema, form);
  if (parsed.error) return parsed.error;
  try {
    await addConsumption(await createClient(), parsed.data);
  } catch (e) {
    const error = friendlyError(e);
    return { fieldErrors: { kgs: error }, values: formValues(form) };
  }
  revalidatePath(`/beams/${parsed.data.beam_id}`);
  revalidatePath('/yarn');
  // Keep the usage type and date for the next line; clear lot and kg.
  return { ok: true, message: L.beam.lineAdded, values: { usage_type: parsed.data.usage_type, entry_date: parsed.data.entry_date } };
}

export async function deleteConsumptionAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const beamId = String(form.get('beam_id') ?? '');
  await deleteConsumption(await createClient(), id);
  revalidatePath(`/beams/${beamId}`);
  revalidatePath('/yarn');
}

/** Fresh balance for one lot, so the form shows what is available right now. */
export async function lotAvailableAction(lotId: string): Promise<number | null> {
  const lot = await getLotBalance(await createClient(), lotId).catch(() => null);
  return lot ? Number(lot.balance_kg) : null;
}

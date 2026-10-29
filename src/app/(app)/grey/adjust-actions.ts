'use server';

import { revalidatePath } from 'next/cache';
import { createGreyAdjustment, createYarnAdjustment } from '@/lib/data/adjustments';
import { friendlyError } from '@/lib/errors';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { formValues, greyAdjustmentSchema, parseForm, yarnAdjustmentSchema, type FormState } from '@/lib/validation';

export async function yarnAdjustAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(yarnAdjustmentSchema, form);
  if (parsed.error) return parsed.error;
  try {
    await createYarnAdjustment(await createClient(), parsed.data);
  } catch (e) {
    return { error: friendlyError(e), values: formValues(form) };
  }
  revalidatePath(`/yarn/${parsed.data.yarn_lot_id}`);
  revalidatePath('/yarn');
  revalidatePath('/');
  return { ok: true, message: L.adjust.saved };
}

export async function greyAdjustAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(greyAdjustmentSchema, form);
  if (parsed.error) return parsed.error;
  try {
    await createGreyAdjustment(await createClient(), parsed.data);
  } catch (e) {
    return { error: friendlyError(e), values: formValues(form) };
  }
  revalidatePath('/grey');
  revalidatePath('/');
  return { ok: true, message: L.adjust.saved };
}

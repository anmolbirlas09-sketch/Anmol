'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createLot } from '@/lib/data/yarn';
import { friendlyError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { formValues, parseForm, yarnLotSchema, type FormState } from '@/lib/validation';

export async function createLotAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(yarnLotSchema, form);
  if (parsed.error) return parsed.error;
  let lotNo: string;
  try {
    lotNo = (await createLot(await createClient(), parsed.data)).lot_no;
  } catch (e) {
    const error = friendlyError(e);
    const field = error.includes('lot no') ? { lot_no: error } : undefined;
    return { error: field ? undefined : error, fieldErrors: field, values: formValues(form) };
  }
  revalidatePath('/yarn');
  revalidatePath('/');
  redirect(form.get('another') ? `/yarn/new?saved=${encodeURIComponent(lotNo)}` : `/yarn?saved=${encodeURIComponent(lotNo)}`);
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveMaster } from '@/lib/data/masters';
import { friendlyError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { fabricQualitySchema, formValues, parseForm, supplierSchema, yarnQualitySchema, type FormState } from '@/lib/validation';
import { MASTER_KINDS, isMasterKind } from './config';

const schemas = {
  'yarn-qualities': yarnQualitySchema,
  'fabric-qualities': fabricQualitySchema,
  suppliers: supplierSchema,
};

export async function saveMasterAction(kind: string, id: string | null, _: FormState, form: FormData): Promise<FormState> {
  if (!isMasterKind(kind)) return { error: 'Unknown master' };
  const parsed = parseForm(schemas[kind], form);
  if (parsed.error) return parsed.error;
  try {
    await saveMaster(await createClient(), MASTER_KINDS[kind].table, parsed.data, id ?? undefined);
  } catch (e) {
    const error = friendlyError(e);
    return error.includes('already exists') ? { fieldErrors: { name: error }, values: formValues(form) } : { error, values: formValues(form) };
  }
  revalidatePath('/masters', 'layout');
  redirect(`/masters/${kind}?saved=1`);
}

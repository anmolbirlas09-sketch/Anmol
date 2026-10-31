'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { saveMaster, saveSpecification } from '@/lib/data/masters';
import { friendlyError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { L } from '@/lib/labels';
import { fabricQualitySchema, formValues, parseForm, specificationSchema, supplierSchema, yarnQualitySchema, type FormState } from '@/lib/validation';
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
  let savedId: string;
  try {
    savedId = await saveMaster(await createClient(), MASTER_KINDS[kind].table, parsed.data, id ?? undefined);
  } catch (e) {
    const error = friendlyError(e);
    return error.includes('already exists') ? { fieldErrors: { name: error }, values: formValues(form) } : { error, values: formValues(form) };
  }
  revalidatePath('/masters', 'layout');
  // A fabric quality is a parent: go to its page so its specifications can be added or reviewed.
  redirect(kind === 'fabric-qualities' ? `/masters/${kind}/${savedId}?saved=1` : `/masters/${kind}?saved=1`);
}

/** Create or edit a specification under a parent quality. */
export async function saveSpecificationAction(qualityId: string, specId: string | null, _: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(specificationSchema, form);
  if (parsed.error) return parsed.error;
  if (parsed.data.fabric_quality_id !== qualityId) return { error: L.errors.generic };
  try {
    await saveSpecification(await createClient(), parsed.data, specId ?? undefined);
  } catch (e) {
    const err = e as { db?: { code?: string; message?: string } };
    const error = err.db?.code === '23505' && err.db.message?.includes('combo') ? L.spec.duplicate : friendlyError(e);
    return { error, values: formValues(form) };
  }
  revalidatePath('/masters', 'layout');
  redirect(`/masters/fabric-qualities/${qualityId}?specSaved=1`);
}

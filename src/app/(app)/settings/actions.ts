'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth';
import { saveFactory, saveLoom, setVarianceThreshold, updateUser } from '@/lib/data/settings';
import { friendlyError, notAllowed } from '@/lib/errors';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { factorySchema, formValues, loomSchema, parseForm, settingsSchema, userSchema, type FormState } from '@/lib/validation';

async function run(form: FormData, fn: () => Promise<unknown>, paths: string[]): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    return { error: friendlyError(e), values: formValues(form) };
  }
  for (const p of paths) revalidatePath(p, 'layout');
  // Keep what was saved in the form; otherwise React's post-submit reset shows the old values.
  return { ok: true, message: L.settings.saved, values: formValues(form) };
}

export async function saveUserAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(userSchema, form);
  if (parsed.error) return parsed.error;
  const me = await getCurrentUser();
  const v = parsed.data;
  // Don't let the owner lock themselves out.
  if (me?.id === v.id && (v.role !== 'owner' || !v.active)) return { error: 'You cannot remove your own owner access.', values: formValues(form) };
  return run(form, async () => {
    if (!(await updateUser(await createClient(), v.id, { name: v.name, role: v.role, active: v.active, factory_id: v.factory_id ?? null }))) throw notAllowed();
  }, ['/settings/users']);
}

export async function saveLoomAction(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(loomSchema, form);
  if (parsed.error) return parsed.error;
  return run(form, async () => saveLoom(await createClient(), parsed.data, id ?? undefined), ['/settings/looms', '/looms', '/']);
}

export async function saveFactoryAction(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(factorySchema, form);
  if (parsed.error) return parsed.error;
  return run(form, async () => saveFactory(await createClient(), parsed.data, id ?? undefined), ['/settings/factories', '/']);
}

export async function saveSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(settingsSchema, form);
  if (parsed.error) return parsed.error;
  return run(form, async () => setVarianceThreshold(await createClient(), parsed.data.variance_threshold_pct), ['/settings/general', '/beams', '/reports']);
}

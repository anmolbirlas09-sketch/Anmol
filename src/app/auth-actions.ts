'use server';

import { redirect } from 'next/navigation';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { formValues, type FormState } from '@/lib/validation';

const safeNext = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : '/');

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: values.email ?? '', password: values.password ?? '' });
  if (error) return { error: L.auth.badCredentials, values: { email: values.email ?? '' } };
  redirect(safeNext(form.get('next')));
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const values = formValues(form);
  const keep = { email: values.email ?? '', name: values.name ?? '' };
  if ((values.password ?? '').length < 8) return { fieldErrors: { password: L.auth.passwordTooShort }, values: keep };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: values.email ?? '',
    password: values.password ?? '',
    options: { data: { name: values.name ?? '' } },
  });
  if (error) return { error: error.message, values: keep };
  if (!data.session) return { ok: true, message: L.auth.checkEmail };
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

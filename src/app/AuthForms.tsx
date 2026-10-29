'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { SubmitButton, fieldProps } from '@/components/form';
import { Field, Notice, inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { FormState } from '@/lib/validation';
import { signIn, signUp } from './auth-actions';

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, {} as FormState);
  return (
    <form action={action} className="space-y-4">
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <input type="hidden" name="next" value={next ?? '/'} />
      <Field label={L.auth.email} htmlFor="email">
        <input {...fieldProps('email', state)} type="email" autoComplete="email" required className={inputClass} />
      </Field>
      <Field label={L.auth.password} htmlFor="password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <SubmitButton pendingText={L.auth.signingIn} className="w-full">
        {L.auth.signIn}
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        {L.auth.noAccount}{' '}
        <Link href="/signup" className="font-semibold text-brand">
          {L.auth.signUp}
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUp, {} as FormState);
  if (state.ok) return <Notice tone="ok">{state.message}</Notice>;
  return (
    <form action={action} className="space-y-4">
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <Field label={L.auth.name} htmlFor="name">
        <input {...fieldProps('name', state)} autoComplete="name" required className={inputClass} />
      </Field>
      <Field label={L.auth.email} htmlFor="email">
        <input {...fieldProps('email', state)} type="email" autoComplete="email" required className={inputClass} />
      </Field>
      <Field label={L.auth.password} htmlFor="password" error={state.fieldErrors?.password} hint={L.auth.passwordTooShort}>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
      </Field>
      <SubmitButton pendingText={L.auth.signingUp} className="w-full">
        {L.auth.signUp}
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        {L.auth.haveAccount}{' '}
        <Link href="/login" className="font-semibold text-brand">
          {L.auth.signIn}
        </Link>
      </p>
    </form>
  );
}

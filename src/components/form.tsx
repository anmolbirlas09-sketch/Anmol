'use client';

import { useFormStatus } from 'react-dom';
import { L } from '@/lib/labels';
import { buttonClass, cx } from './ui';

export function SubmitButton({
  children, pendingText = L.app.saving, variant = 'primary', className, disabled, name, value,
}: {
  children: React.ReactNode; pendingText?: string; variant?: keyof typeof buttonClass; className?: string; disabled?: boolean;
  name?: string; value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={name ? (value ?? '1') : undefined} disabled={pending || disabled} className={cx(buttonClass[variant], className)}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Props for an <input> wired to a FormState: refilled value + error description. */
export function fieldProps(
  name: string,
  state: { values?: Record<string, string>; fieldErrors?: Record<string, string> } | undefined,
  fallback?: string,
) {
  const error = state?.fieldErrors?.[name];
  return {
    id: name,
    name,
    defaultValue: state?.values?.[name] ?? fallback,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${name}-error` : undefined,
  } as const;
}

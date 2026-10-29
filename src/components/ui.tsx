import { L } from '@/lib/labels';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// Big touch targets: inputs and buttons are at least 48px tall.
export const inputClass =
  'block w-full min-h-12 rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-muted ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-sunken aria-[invalid=true]:border-bad';

const buttonBase =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition ' +
  'disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';
export const buttonClass = {
  primary: `${buttonBase} bg-brand text-brand-ink hover:brightness-110`,
  secondary: `${buttonBase} border border-line bg-surface text-ink hover:bg-sunken`,
  danger: `${buttonBase} border border-bad/40 bg-surface text-bad hover:bg-bad-soft`,
  ghost: `${buttonBase} text-brand hover:bg-brand-soft`,
};

export function LinkButton({ variant = 'primary', className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonClass }) {
  return <Link className={cx(buttonClass[variant], className)} {...props} />;
}

export function PageHeader({ title, back, action, subtitle }: { title: string; back?: string; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-1 inline-flex min-h-8 items-center text-sm font-medium text-brand">
            ← {L.app.back}
          </Link>
        )}
        <h1 className="truncate text-2xl font-bold">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<'section'>) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface p-4', className)} {...rest}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

const tones = {
  neutral: 'bg-sunken text-muted',
  brand: 'bg-brand-soft text-brand',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
};
export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function Notice({ tone = 'brand', children, role }: { tone?: Tone; children: ReactNode; role?: string }) {
  return (
    <div role={role ?? (tone === 'bad' ? 'alert' : 'status')} className={cx('rounded-lg px-3 py-2.5 text-sm font-medium', tones[tone])}>
      {children}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({
  label, htmlFor, error, hint, optional, children, className,
}: {
  label: string; htmlFor: string; error?: string; hint?: ReactNode; optional?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-sm font-medium text-bad">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-sm text-muted">{hint}</p>
      )}
    </div>
  );
}

/** Link-based segmented control, e.g. All / L-76 / L-75. */
export function Segmented({ items, label }: { label: string; items: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto rounded-lg bg-sunken p-1">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? 'page' : undefined}
          className={cx(
            'flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-semibold',
            i.active ? 'bg-surface text-ink shadow-sm' : 'text-muted',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Stat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={cx('tnum mt-1 text-xl font-bold', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-muted">{unit}</span>}
      </div>
    </div>
  );
}

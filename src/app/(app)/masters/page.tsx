import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { L } from '@/lib/labels';
import { MASTER_KINDS } from './config';

export const metadata: Metadata = { title: L.masters.title };

export default async function MastersPage() {
  await requireUser();
  return (
    <>
      <PageHeader title={L.masters.title} />
      <ul className="grid gap-2 sm:grid-cols-3">
        {Object.entries(MASTER_KINDS).map(([kind, m]) => (
          <li key={kind}>
            <Link href={`/masters/${kind}`} className="flex min-h-16 items-center justify-between rounded-xl border border-line bg-surface px-4 font-semibold hover:border-brand">
              {m.title} <span aria-hidden className="text-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm">
        <Link href="/settings" className="font-semibold text-brand">{L.masters.looms} ›</Link>
      </p>
    </>
  );
}

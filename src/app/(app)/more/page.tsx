import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { canEdit, isOwner, requireUser } from '@/lib/auth';
import { L } from '@/lib/labels';

export const metadata: Metadata = { title: L.nav.more };

export default async function MorePage() {
  const user = await requireUser();
  const items = [
    { href: '/dispatch', title: L.dispatch.title, show: true },
    { href: '/reports', title: L.reports.title, show: true },
    { href: '/takeoff', title: L.takeoff.title, show: true },
    { href: '/import', title: L.importer.title, show: canEdit(user) },
    { href: '/masters', title: L.masters.title, show: true },
    { href: '/settings', title: L.settings.title, show: isOwner(user) },
  ].filter((i) => i.show);
  return (
    <>
      <PageHeader title={L.nav.more} />
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex min-h-14 items-center justify-between px-4 font-semibold hover:bg-sunken">
              {i.title} <span aria-hidden className="text-muted">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

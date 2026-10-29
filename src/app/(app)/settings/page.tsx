import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice, PageHeader } from '@/components/ui';
import { isOwner, requireUser } from '@/lib/auth';
import { L } from '@/lib/labels';

export const metadata: Metadata = { title: L.settings.title };

const SECTIONS = [
  { href: '/settings/users', title: L.settings.users, hint: L.settings.usersHint },
  { href: '/settings/looms', title: L.settings.looms, hint: L.settings.loomsHint },
  { href: '/settings/factories', title: L.settings.factories, hint: L.settings.factoriesHint },
  { href: '/settings/general', title: L.settings.general, hint: L.settings.generalHint },
];

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title={L.settings.title} back="/more" />
      {!isOwner(user) ? (
        <Notice tone="neutral">{L.settings.ownerOnly}</Notice>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="block min-h-16 rounded-xl border border-line bg-surface p-4 hover:border-brand">
                <div className="font-bold">{s.title}</div>
                <div className="text-sm text-muted">{s.hint}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

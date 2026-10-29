'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { L } from '@/lib/labels';
import { cx } from './ui';

const items = [
  { href: '/', label: L.nav.home, icon: '⌂' },
  { href: '/yarn', label: L.nav.yarn, icon: '◎' },
  { href: '/beams', label: L.nav.beams, icon: '▤' },
  { href: '/masters', label: L.nav.masters, icon: '☰' },
];

const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

/** Bottom tab bar on phones, inline links in the header on wider screens. */
export function Nav({ variant }: { variant: 'bottom' | 'top' }) {
  const path = usePathname();
  if (variant === 'top') {
    return (
      <nav aria-label="Main" className="hidden gap-1 md:flex">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={isActive(path, i.href) ? 'page' : undefined}
            className={cx(
              'rounded-md px-3 py-2 text-sm font-semibold',
              isActive(path, i.href) ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink',
            )}
          >
            {i.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={isActive(path, i.href) ? 'page' : undefined}
          className={cx(
            'flex min-h-14 flex-col items-center justify-center text-xs font-semibold',
            isActive(path, i.href) ? 'text-brand' : 'text-muted',
          )}
        >
          <span aria-hidden className="text-lg leading-none">{i.icon}</span>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

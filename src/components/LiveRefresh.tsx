'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { fmtDateTime } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/client';
import { cx } from './ui';

/** Tables whose changes affect stock, looms or production. */
export const LIVE_TABLES = [
  'looms', 'beams', 'yarn_lots', 'yarn_consumption', 'grey_fabric_production', 'grey_fabric_dispatch', 'stock_adjustments',
] as const;

type Status = 'connecting' | 'live' | 'offline';

/**
 * Listens to Supabase Realtime and re-renders the page's server components when
 * anyone changes data. Numbers are always re-read through the server (and RLS);
 * the realtime message is only a "something changed" signal.
 * Also refreshes when the phone wakes up / the tab becomes visible again.
 */
export function LiveRefresh({ tables = LIVE_TABLES }: { tables?: readonly string[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('connecting');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(',');

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      // Several rows change per entry (e.g. take-off + beam + loom): refresh once.
      timer.current = setTimeout(() => {
        startTransition(() => router.refresh());
        setUpdatedAt(fmtDateTime(new Date().toISOString()).slice(11));
      }, 400);
    };

    let channel = supabase.channel(`live:${key}:${Math.random().toString(36).slice(2)}`);
    for (const table of key.split(',')) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    }
    channel.subscribe((s) => setStatus(s === 'SUBSCRIBED' ? 'live' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED' ? 'offline' : 'connecting'));

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [router, key]);

  return (
    <span role="status" data-live={status} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted">
      <span aria-hidden className={cx('size-2 rounded-full', status === 'live' ? 'bg-ok' : status === 'offline' ? 'bg-bad' : 'bg-warn')} />
      {status === 'live' ? L.live.live : status === 'offline' ? L.live.offline : L.live.connecting}
      {status === 'live' && updatedAt && <span className="font-normal">· {L.live.updated(updatedAt)}</span>}
    </span>
  );
}

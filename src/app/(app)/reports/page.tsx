import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { listFactories } from '@/lib/data/masters';
import { L } from '@/lib/labels';
import { REPORT_KINDS } from '@/lib/reports/model';
import { reportParams, reportQuery } from '@/lib/reports/params';
import { createClient } from '@/lib/supabase/server';
import { ReportFilters } from './ReportFilters';

export const metadata: Metadata = { title: L.reports.title };

export default async function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  const user = await requireUser();
  const factories = await listFactories(await createClient());
  const p = reportParams(await searchParams, factories, user.factory_id);
  const q = reportQuery(p);
  return (
    <>
      <PageHeader title={L.reports.title} />
      <div className="mb-4">
        <ReportFilters action="/reports" p={p} factories={factories} lockedFactory={Boolean(user.factory_id)} showPeriod />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {REPORT_KINDS.map((k) => (
          <li key={k}>
            <Link href={`/reports/${k}?${q}`} className="block min-h-20 rounded-xl border border-line bg-surface p-4 hover:border-brand">
              <div className="font-bold">{L.reports.kinds[k].title}</div>
              <div className="mt-1 text-sm text-muted">{L.reports.kinds[k].hint}</div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

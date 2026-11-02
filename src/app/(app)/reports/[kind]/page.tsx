import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LinkButton, PageHeader, cx } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { listLooms } from '@/lib/data/settings';
import { listFabricQualities, listFactories, listSpecifications } from '@/lib/data/masters';
import { getVarianceThreshold } from '@/lib/data/settings';
import { L } from '@/lib/labels';
import { buildReport } from '@/lib/reports/build';
import { FILTERABLE, TIMED, formatCell, isNumeric, isReportKind } from '@/lib/reports/model';
import { reportParams, reportQuery } from '@/lib/reports/params';
import { createClient } from '@/lib/supabase/server';
import { ReportFilters } from '../ReportFilters';

export const metadata: Metadata = { title: L.reports.title };

export default async function ReportPage({ params, searchParams }: PageProps<'/reports/[kind]'>) {
  const user = await requireUser();
  const { kind } = await params;
  if (!isReportKind(kind)) notFound();
  const db = await createClient();
  const filterable = FILTERABLE.includes(kind);
  const [factories, looms, qualities, specs] = await Promise.all([
    listFactories(db),
    filterable ? listLooms(db) : Promise.resolve([]),
    filterable ? listFabricQualities(db) : Promise.resolve([]),
    filterable ? listSpecifications(db) : Promise.resolve([]),
  ]);
  const visibleLooms = looms.filter((l) => !user.factory_id || l.factory_id === user.factory_id);
  const p = reportParams(await searchParams, factories, user.factory_id, { looms, qualities, specs }, kind === 'daily');
  const [r, threshold] = await Promise.all([buildReport(db, kind, p), kind === 'variance' ? getVarianceThreshold(db) : null]);
  const q = reportQuery(p);

  return (
    <>
      <PageHeader
        title={r.title}
        back={`/reports?${q}`}
        subtitle={r.subtitle}
      />
      <div className="-mt-2 mb-4 grid grid-cols-2 gap-2 sm:flex">
        <LinkButton href={`/reports/${kind}/export?${q}&format=xlsx`} variant="secondary" prefetch={false}>{L.reports.excel} ↓</LinkButton>
        <LinkButton href={`/reports/${kind}/export?${q}&format=pdf`} variant="secondary" prefetch={false}>{L.reports.pdf} ↓</LinkButton>
      </div>
      <div className="mb-4">
        <ReportFilters
          action={`/reports/${kind}`}
          p={p}
          factories={factories}
          lockedFactory={Boolean(user.factory_id)}
          showPeriod={kind === 'loom-production'}
          looms={filterable ? visibleLooms : undefined}
          qualities={filterable ? qualities : undefined}
          specs={filterable ? specs : undefined}
          specsToggle={kind === 'specifications'}
          timed={TIMED.includes(kind)}
          groupBy={kind === 'daily'}
        />
      </div>
      <p className="mb-2 text-sm text-muted">
        {L.reports.rows(r.rows.length)}
        {threshold !== null && ` · ${L.beam.threshold(String(threshold))}`}
      </p>

      {r.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center text-muted">{L.reports.empty}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="tnum min-w-full border-separate border-spacing-0 rounded-xl border border-line bg-surface text-sm" aria-label={r.title}>
            <thead>
              <tr>
                {r.columns.map((c, i) => (
                  <th key={c.key} scope="col" className={cx(
                    'whitespace-nowrap border-b border-line bg-sunken px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted',
                    isNumeric(c.kind) ? 'text-right' : 'text-left',
                    i === 0 && 'sticky left-0 z-10',
                  )}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, ri) => (
                <tr key={ri} className={cx(r.flagged?.[ri] && 'text-bad', r.indented?.[ri] && 'text-sm', r.indented && !r.indented[ri] && 'font-semibold')}
                  data-flag={r.flagged?.[ri] || undefined} data-level={r.indented ? (r.indented[ri] ? 'spec' : 'parent') : undefined}>
                  {r.columns.map((c, i) => (
                    <td key={c.key} className={cx(
                      'whitespace-nowrap border-b border-line px-3 py-2',
                      isNumeric(c.kind) && 'text-right',
                      i === 0 && 'sticky left-0 bg-surface font-semibold',
                      i === 0 && r.indented?.[ri] && 'pl-6 font-normal',
                      r.flagged?.[ri] && c.kind === 'flag' && 'font-bold',
                    )}>{formatCell(c.kind, row[c.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            {r.totals && (
              <tfoot>
                <tr className="font-bold">
                  {r.columns.map((c, i) => (
                    <td key={c.key} className={cx('whitespace-nowrap bg-sunken px-3 py-2', isNumeric(c.kind) && 'text-right', i === 0 && 'sticky left-0')}>
                      {i === 0 ? L.reports.total : c.total ? formatCell(c.kind, r.totals![c.key]) : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  );
}

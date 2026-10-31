import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveRefresh } from '@/components/LiveRefresh';
import { Badge, Card, LinkButton, Notice, Segmented, Stat } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { loadDashboard } from '@/lib/data/dashboard';
import { listFactories } from '@/lib/data/masters';
import { fmtKg, fmtM, todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { factoryParam } from '@/lib/params';
import { createClient } from '@/lib/supabase/server';
import { LoomGridSheet } from './LoomGridSheet';

export const metadata: Metadata = { title: L.dashboard.title };

export default async function DashboardPage({ searchParams }: PageProps<'/'>) {
  const user = await requireUser();
  const { factory: f, specs: specsParam } = await searchParams;
  const showSpecs = specsParam === '1';
  const db = await createClient();
  const factories = await listFactories(db);
  // Owners start on "All"; factory staff on their own factory.
  const factoryId = factoryParam(f, factories, user.factory_id);
  const d = await loadDashboard(db, { factoryId, today: todayIST() });
  const low = d.yarn.filter((y) => y.is_low_stock);

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{L.dashboard.title}</h1>
          <p className="text-sm text-muted">{L.home.hello}, {user.name.split(' ')[0]}</p>
        </div>
        <LiveRefresh />
      </div>

      <div className="mb-4">
        <Segmented
          label={L.beam.factory}
          items={[
            { href: '/?factory=all', label: L.app.all, active: !factoryId },
            ...factories.map((x) => ({ href: `/?factory=${x.id}`, label: x.code, active: factoryId === x.id })),
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat testId="stat-yarn" label={L.dashboard.yarnStock} value={fmtKg(d.yarnKg)} unit="kg" />
        <Stat testId="stat-grey" label={L.dashboard.greyStock} value={fmtM(d.greyM)} unit="m"
          sub={`${fmtKg(d.greyKg)} kg${d.greyUnweighed > 0 ? ` (${L.production.weighed})` : ''}`} />
        <Stat testId="stat-looms" label={L.dashboard.looms} value={L.dashboard.loomsValue(d.running, d.looms.length)} sub={L.dashboard.loomsSub(d.running, d.idle, d.maintenance)} />
        <Stat testId="stat-today" label={L.dashboard.today} value={fmtM(d.todayM)} unit="m"
          sub={L.dashboard.todaySub(fmtM(d.todayNetM), fmtM(d.todayWastedM), d.todayWastagePct !== null ? `${d.todayWastagePct.toFixed(2)}%` : L.app.none)} />
      </div>
      {(d.todayKg !== null || d.todayEstimatedKg !== null) && (
        <div className="mt-3">
          <Stat testId="stat-today-kg" label={L.dashboard.todayKg}
            value={d.todayKg !== null ? `${fmtKg(d.todayKg)} kg` : `≈${fmtKg(d.todayEstimatedKg)} kg`}
            sub={L.dashboard.todayKgSub(d.todayEstimatedKg !== null ? `${fmtKg(d.todayEstimatedKg)} kg` : L.app.none, d.todayKg !== null ? `${fmtKg(d.todayKg)} kg` : L.app.none)} />
        </div>
      )}

      {low.length > 0 && (
        <div className="mt-3">
          <Notice tone="warn">
            {L.yarn.lowStock}: {low.map((r) => `${r.yarn_quality_name} (${fmtKg(r.balance_kg)} kg)`).join(', ')}
          </Notice>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <LinkButton href="/takeoff">{L.takeoff.short}</LinkButton>
        <LinkButton href="/looms/load">{L.loom.loadShort}</LinkButton>
        <LinkButton href="/yarn/new" variant="secondary">+ {L.yarn.newLotShort}</LinkButton>
        <LinkButton href="/beams/new" variant="secondary">+ {L.beam.newBeam}</LinkButton>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">{L.dashboard.loomGrid}</h2>
      <LoomGridSheet looms={d.looms} userFactoryId={user.factory_id} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <table className="tnum w-full text-sm">
            <caption className="px-4 pt-3 text-left font-semibold">{L.dashboard.greyByQuality}</caption>
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-semibold">{L.dashboard.quality}</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">m</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {d.grey.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-3 text-muted">{L.dashboard.noGrey}</td></tr>
              )}
              {d.grey.flatMap((g) => [
                <tr key={g.fabric_quality_id}>
                  <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                    {g.fabric_quality_name}
                    <span className="ml-1 text-xs font-normal text-muted">({g.specs.length})</span>
                  </th>
                  <td className="px-2 py-2.5 text-right">{fmtM(g.stock_m)}</td>
                  <td className="px-4 py-2.5 text-right">{fmtKg(g.stock_kg)}</td>
                </tr>,
                ...(showSpecs
                  ? g.specs.map((sp) => (
                      <tr key={sp.fabric_specification_id} className="bg-sunken/60 text-xs" data-spec={sp.spec_code}>
                        <th scope="row" className="py-2 pl-8 pr-4 text-left font-normal">↳ {sp.spec_code}</th>
                        <td className="px-2 py-2 text-right">{fmtM(sp.stock_m)}</td>
                        <td className="px-4 py-2 text-right">{fmtKg(sp.stock_kg)}</td>
                      </tr>
                    ))
                  : []),
              ])}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
            <Link
              href={`/?${new URLSearchParams({ ...(factoryId ? { factory: factoryId } : { factory: 'all' }), ...(showSpecs ? {} : { specs: '1' }) })}`}
              className="text-sm font-semibold text-brand"
              data-testid="toggle-specs"
            >
              {showSpecs ? L.spec.collapse : L.spec.expand}
            </Link>
            <Link href={factoryId ? `/grey?factory=${factoryId}` : '/grey'} className="text-sm font-semibold text-brand">{L.grey.title} ›</Link>
          </div>
        </Card>

        <Card className="p-0">
          <table className="tnum w-full text-sm">
            <caption className="px-4 pt-3 text-left font-semibold">{L.dashboard.yarnByQuality}</caption>
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-semibold">{L.dashboard.quality}</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {d.yarn.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-3 text-muted">{L.dashboard.noYarn}</td></tr>
              )}
              {d.yarn.map((y) => (
                <tr key={y.yarn_quality_id}>
                  <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                    {y.yarn_quality_name} {y.is_low_stock && <Badge tone="warn">{L.yarn.lowStock}</Badge>}
                  </th>
                  <td className="px-4 py-2.5 text-right">{fmtKg(y.balance_kg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-end justify-between gap-3 px-4 pb-3 pt-1">
            <span className="text-xs text-muted">{factoryId ? L.dashboard.yarnFactoryNote : ''}</span>
            <Link href="/yarn" className="shrink-0 text-sm font-semibold text-brand">{L.yarn.title} ›</Link>
          </div>
        </Card>
      </div>

      <p className="mt-6 text-center text-sm">
        <Link href="/masters" className="font-semibold text-brand">{L.masters.title} ›</Link>
      </p>
    </>
  );
}

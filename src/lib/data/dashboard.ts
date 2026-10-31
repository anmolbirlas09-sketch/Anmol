import { unwrap } from '../errors';
import type { GreyStockRow, LoomStatusRow, ProductionDaily, YarnStockByQuality } from '../types';
import type { Db } from './client';
import { greyStock, groupGreyByQuality, type GreyByQuality } from './grey';
import { listLoomStatus } from './looms';

export async function productionOn(db: Db, date: string, factoryId?: string): Promise<ProductionDaily[]> {
  let q = db.from('v_production_daily').select('*').eq('entry_date', date);
  if (factoryId) q = q.eq('factory_id', factoryId);
  return unwrap(await q.order('machine_no'));
}

export interface YarnRow {
  yarn_quality_id: string;
  yarn_quality_name: string;
  balance_kg: number;
  /** Only known for the all-factory view: reorder levels are set per quality, not per factory. */
  is_low_stock: boolean | null;
}

/** Yarn stock by quality; for one factory, counts lots received there. */
export async function yarnByQuality(db: Db, factoryId?: string): Promise<YarnRow[]> {
  if (!factoryId) {
    const rows: YarnStockByQuality[] = unwrap(await db.from('v_yarn_stock_by_quality').select('*').order('yarn_quality_name'));
    return rows.map((r) => ({ yarn_quality_id: r.yarn_quality_id, yarn_quality_name: r.yarn_quality_name, balance_kg: r.balance_kg, is_low_stock: r.is_low_stock }));
  }
  const rows = unwrap(
    await db.from('v_yarn_stock_by_quality_factory').select('*').eq('factory_id', factoryId).order('yarn_quality_name'),
  ) as { yarn_quality_id: string; yarn_quality_name: string; balance_kg: number }[];
  return rows.map((r) => ({ ...r, is_low_stock: null }));
}

export interface Dashboard {
  yarnKg: number;
  yarn: YarnRow[];
  grey: GreyByQuality[];
  greyM: number;
  greyKg: number;
  /** Production entries without a weighed kg: grey kg counts weighed fabric only */
  greyUnweighed: number;
  looms: LoomStatusRow[];
  running: number;
  idle: number;
  maintenance: number;
  /** Today: total production, wasted and net usable metres; wastage % by metres */
  todayM: number;
  todayWastedM: number;
  todayNetM: number;
  todayWastagePct: number | null;
  todayTakeoffs: number;
  /** Today's weights — null when nothing of that kind was recorded */
  todayKg: number | null;
  todayEstimatedKg: number | null;
}

/** Everything the dashboard shows, for all factories or one. */
export async function loadDashboard(db: Db, opts: { factoryId?: string; today: string }): Promise<Dashboard> {
  const [yarn, greyRows, looms, today] = await Promise.all([
    yarnByQuality(db, opts.factoryId),
    greyStock(db, { factoryId: opts.factoryId }),
    listLoomStatus(db, { factoryId: opts.factoryId }),
    productionOn(db, opts.today, opts.factoryId),
  ]);
  const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
  /** Sum of values that were recorded; null when none were (missing ≠ 0). */
  const sumKnown = <T,>(rows: T[], f: (r: T) => number | null) => {
    const known = rows.map(f).filter((v): v is number => v !== null && v !== undefined);
    return known.length ? known.reduce((s, v) => s + v, 0) : null;
  };
  const grey = groupGreyByQuality(greyRows as GreyStockRow[]);
  return {
    yarnKg: sum(yarn, (r) => r.balance_kg),
    yarn: yarn.filter((r) => r.balance_kg !== 0 || r.is_low_stock),
    grey,
    greyM: sum(grey, (g) => g.stock_m),
    greyKg: sum(grey, (g) => g.stock_kg),
    greyUnweighed: sum(grey, (g) => g.unweighed_count),
    looms,
    running: looms.filter((l) => l.status === 'running').length,
    idle: looms.filter((l) => l.status === 'idle').length,
    maintenance: looms.filter((l) => l.status === 'maintenance').length,
    todayM: sum(today, (r) => r.meters),
    todayWastedM: sum(today, (r) => r.wasted_meters),
    todayNetM: sum(today, (r) => r.net_meters),
    todayWastagePct: (() => {
      const m = sum(today, (r) => r.meters);
      return m > 0 ? Math.round((sum(today, (r) => r.wasted_meters) / m) * 10000) / 100 : null;
    })(),
    todayTakeoffs: sum(today, (r) => r.takeoff_count),
    todayKg: sumKnown(today, (r) => r.kgs),
    todayEstimatedKg: sumKnown(today, (r) => r.estimated_kg),
  };
}

import { unwrap } from '../errors';
import type { GreyStockRow } from '../types';
import type { Db } from './client';

/** Grey stock per fabric quality per factory (only rows with any movement). */
export async function greyStock(db: Db, f: { factoryId?: string } = {}): Promise<GreyStockRow[]> {
  let q = db.from('v_grey_stock').select('*');
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  return unwrap(await q.order('fabric_quality_name').order('factory_code', { ascending: false }));
}

export interface GreyByQuality {
  fabric_quality_id: string;
  fabric_quality_name: string;
  produced_m: number;
  produced_kg: number;
  dispatched_m: number;
  dispatched_kg: number;
  stock_m: number;
  stock_kg: number;
  factories: GreyStockRow[];
}

/** Roll per-factory rows up to one row per quality, keeping the factory split. */
export function groupGreyByQuality(rows: GreyStockRow[]): GreyByQuality[] {
  const map = new Map<string, GreyByQuality>();
  for (const r of rows) {
    const g = map.get(r.fabric_quality_id) ?? {
      fabric_quality_id: r.fabric_quality_id, fabric_quality_name: r.fabric_quality_name,
      produced_m: 0, produced_kg: 0, dispatched_m: 0, dispatched_kg: 0, stock_m: 0, stock_kg: 0, factories: [],
    };
    g.produced_m += r.produced_m;
    g.produced_kg += r.produced_kg;
    g.dispatched_m += r.dispatched_m;
    g.dispatched_kg += r.dispatched_kg;
    g.stock_m += r.stock_m;
    g.stock_kg += r.stock_kg;
    g.factories.push(r);
    map.set(r.fabric_quality_id, g);
  }
  return [...map.values()];
}

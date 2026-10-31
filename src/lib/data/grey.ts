import { unwrap } from '../errors';
import type { GreyStockRow } from '../types';
import type { Db } from './client';

/** Grey stock per fabric quality per factory (only rows with any movement). */
export async function greyStock(db: Db, f: { factoryId?: string } = {}): Promise<GreyStockRow[]> {
  let q = db.from('v_grey_stock').select('*');
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  return unwrap(await q.order('fabric_quality_name').order('spec_code').order('factory_code', { ascending: false }));
}

export interface GreySpecGroup {
  fabric_specification_id: string;
  spec_code: string;
  reed: number | null;
  ends_per_inch: number | null;
  warp_yarn_quality_name: string | null;
  weft_yarn_quality_name: string | null;
  produced_m: number;
  dispatched_m: number;
  stock_m: number;
  stock_kg: number;
  unweighed_count: number;
  /** This specification's stock at each factory */
  factories: GreyStockRow[];
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
  /** Production entries without a weighed kg (kg figures are then partial) */
  unweighed_count: number;
  /** Parent totals per factory (all specifications added up) */
  factories: { factory_id: string; factory_code: string; stock_m: number; stock_kg: number }[];
  /** Each specification's own stock — never merged */
  specs: GreySpecGroup[];
}

/** Roll specification × factory rows up to parent quality, keeping each specification apart. */
export function groupGreyByQuality(rows: GreyStockRow[]): GreyByQuality[] {
  const map = new Map<string, GreyByQuality>();
  for (const r of rows) {
    const g = map.get(r.fabric_quality_id) ?? {
      fabric_quality_id: r.fabric_quality_id, fabric_quality_name: r.fabric_quality_name,
      produced_m: 0, produced_kg: 0, dispatched_m: 0, dispatched_kg: 0, stock_m: 0, stock_kg: 0, unweighed_count: 0,
      factories: [], specs: [],
    };
    g.produced_m += r.produced_m;
    g.produced_kg += r.produced_kg;
    g.dispatched_m += r.dispatched_m;
    g.dispatched_kg += r.dispatched_kg;
    g.stock_m += r.stock_m;
    g.stock_kg += r.stock_kg;
    g.unweighed_count += Number(r.unweighed_count ?? 0);

    const f = g.factories.find((x) => x.factory_id === r.factory_id);
    if (f) {
      f.stock_m += r.stock_m;
      f.stock_kg += r.stock_kg;
    } else g.factories.push({ factory_id: r.factory_id, factory_code: r.factory_code, stock_m: r.stock_m, stock_kg: r.stock_kg });

    let sp = g.specs.find((x) => x.fabric_specification_id === r.fabric_specification_id);
    if (!sp) {
      sp = {
        fabric_specification_id: r.fabric_specification_id, spec_code: r.spec_code, reed: r.reed, ends_per_inch: r.ends_per_inch,
        warp_yarn_quality_name: r.warp_yarn_quality_name, weft_yarn_quality_name: r.weft_yarn_quality_name,
        produced_m: 0, dispatched_m: 0, stock_m: 0, stock_kg: 0, unweighed_count: 0, factories: [],
      };
      g.specs.push(sp);
    }
    sp.produced_m += r.produced_m;
    sp.dispatched_m += r.dispatched_m;
    sp.stock_m += r.stock_m;
    sp.stock_kg += r.stock_kg;
    sp.unweighed_count += Number(r.unweighed_count ?? 0);
    sp.factories.push(r);
    map.set(r.fabric_quality_id, g);
  }
  for (const g of map.values()) g.specs.sort((a, b) => a.spec_code.localeCompare(b.spec_code, 'en', { numeric: true }));
  return [...map.values()];
}

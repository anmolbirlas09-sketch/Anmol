import { unwrap } from '../errors';
import type { GreyImportRow, ImportMasters, YarnImportRow } from '../importer';
import type { Db } from './client';
import { fetchAll } from './paging';

/** Masters the import checker needs. allowedFactoryIds = null for users who work across factories. */
export async function importMasters(db: Db, userFactoryId: string | null): Promise<ImportMasters> {
  const [yq, fq, factories, suppliers, lots, specs] = await Promise.all([
    db.from('yarn_qualities').select('id, name').eq('active', true),
    db.from('fabric_qualities').select('id, name').eq('active', true),
    db.from('factories').select('id, code').eq('active', true).order('sort_order'),
    db.from('suppliers').select('id, name').eq('active', true),
    fetchAll<{ lot_no: string }>((from, to) => db.from('yarn_lots').select('lot_no').order('lot_no').range(from, to)),
    db.from('fabric_specifications').select('id, spec_code, fabric_quality_id').eq('active', true).order('spec_code'),
  ]);
  return {
    yarnQualities: unwrap(yq),
    fabricQualities: unwrap(fq),
    factories: unwrap(factories),
    suppliers: unwrap(suppliers),
    specifications: unwrap(specs),
    existingLotNos: lots.map((l) => l.lot_no),
    allowedFactoryIds: userFactoryId ? [userFactoryId] : null,
  };
}

/** One insert statement → all rows or none. */
export async function importYarnRows(db: Db, rows: YarnImportRow[]): Promise<number> {
  const payload = rows.map((r) => ({
    lot_no: r.lot_no, yarn_quality_id: r.yarn_quality_id, factory_id: r.factory_id, kgs_received: r.kgs_received,
    inward_date: r.inward_date, supplier_id: r.supplier_id ?? null, challan_no: r.challan_no ?? null,
    bags_count: r.bags_count ?? null, cones_count: r.cones_count ?? null, rate_per_kg: r.rate_per_kg ?? null,
    notes: r.notes ?? null, is_opening: true,
  }));
  return unwrap(await db.from('yarn_lots').insert(payload).select('id')).length;
}

export async function importGreyRows(db: Db, rows: GreyImportRow[]): Promise<number> {
  const payload = rows.map((r) => ({
    item_type: 'grey_fabric', fabric_quality_id: r.fabric_quality_id, fabric_specification_id: r.fabric_specification_id, factory_id: r.factory_id,
    meters: r.meters, kgs: r.kgs, entry_date: r.entry_date, reason: r.notes ? `Opening stock — ${r.notes}` : 'Opening stock', is_opening: true,
  }));
  return unwrap(await db.from('stock_adjustments').insert(payload).select('id')).length;
}

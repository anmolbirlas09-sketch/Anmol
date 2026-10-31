import { unwrap } from '../errors';
import type { GreyAdjustmentInput, YarnAdjustmentInput } from '../validation';
import type { Db, SpecOptional } from './client';

export async function createYarnAdjustment(db: Db, a: YarnAdjustmentInput): Promise<{ id: string }> {
  // factory_id is overwritten from the lot by a trigger; it only needs a value.
  const lot = unwrap(await db.from('yarn_lots').select('factory_id').eq('id', a.yarn_lot_id).single()) as { factory_id: string };
  return unwrap(
    await db
      .from('stock_adjustments')
      .insert({ item_type: 'yarn_lot', yarn_lot_id: a.yarn_lot_id, factory_id: lot.factory_id, kgs: a.kgs, reason: a.reason, entry_date: a.entry_date })
      .select('id')
      .single(),
  );
}

export async function createGreyAdjustment(db: Db, a: SpecOptional<GreyAdjustmentInput> & { is_opening?: boolean }): Promise<{ id: string }> {
  return unwrap(
    await db
      .from('stock_adjustments')
      .insert({
        item_type: 'grey_fabric', fabric_quality_id: a.fabric_quality_id, fabric_specification_id: a.fabric_specification_id ?? null, factory_id: a.factory_id,
        meters: a.meters, kgs: a.kgs, reason: a.reason, entry_date: a.entry_date, is_opening: a.is_opening ?? false,
      })
      .select('id')
      .single(),
  );
}

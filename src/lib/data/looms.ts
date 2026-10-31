import { unwrap } from '../errors';
import type { BeamSummary, FabricRoll, LoomStatusRow, Takeoff } from '../types';
import type { ProductionInputForm, TakeoffInput } from '../validation';
import type { Db, SpecOptional } from './client';

/** A production entry as the data layer takes it (counter_reset may be left out). */
export type ProductionEntry = SpecOptional<Omit<ProductionInputForm, 'counter_reset'> & { counter_reset?: boolean }>;

export async function listLoomStatus(db: Db, f: { factoryId?: string; activeOnly?: boolean } = {}): Promise<LoomStatusRow[]> {
  let q = db.from('v_loom_status').select('*');
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  if (f.activeOnly ?? true) q = q.eq('active', true);
  return unwrap(await q.order('factory_code', { ascending: false }).order('sort_order').order('machine_no'));
}

export async function getLoomStatus(db: Db, loomId: string): Promise<LoomStatusRow | null> {
  return unwrap(await db.from('v_loom_status').select('*').eq('loom_id', loomId).maybeSingle());
}

/** Beams not on a loom (new, or unloaded unfinished) that can be loaded. */
export async function listPreparedBeams(db: Db): Promise<BeamSummary[]> {
  return unwrap(await db.from('v_beam_summary').select('*').eq('status', 'prepared').order('register_date').order('card_no'));
}

/**
 * Load a beam on a loom. replace: what to do with a beam already running there
 * (finish it, or unload it unfinished); without it a busy loom is refused.
 */
export async function loadBeam(db: Db, beamId: string, loomId: string, replace?: 'finish' | 'unload'): Promise<void> {
  unwrap(await db.rpc('load_beam', { p_beam_id: beamId, p_loom_id: loomId, p_replace: replace ?? null }));
}

export async function finishBeam(db: Db, beamId: string): Promise<void> {
  unwrap(await db.rpc('finish_beam', { p_beam_id: beamId }));
}

/** Take a beam off its loom unfinished. Its production stays; it can be loaded again later. */
export async function unloadBeam(db: Db, beamId: string): Promise<boolean> {
  unwrap(await db.rpc('unload_beam', { p_beam_id: beamId }));
  return true;
}

export async function recordTakeoff(db: Db, t: TakeoffInput): Promise<{ id: string; beam_id: string }> {
  return unwrap(
    await db.rpc('record_takeoff', {
      p_loom_id: t.loom_id,
      p_meters: t.meters,
      p_kgs: t.kgs,
      p_entry_date: t.entry_date,
      p_shift: t.shift ?? null,
      p_roll_no: t.roll_no ?? null,
      p_notes: t.notes ?? null,
      p_finish_beam: t.finish_beam,
    }),
  ) as { id: string; beam_id: string };
}

/**
 * Metre-first production entry (one per loom per shift, typically): stores the
 * entry, creates its rolls from the usable metres and optionally finishes the
 * beam — all in one transaction. Re-sending the same client_ref returns the
 * first entry instead of creating a duplicate.
 */
export async function recordProduction(db: Db, p: ProductionEntry): Promise<Takeoff & { roll_count: number }> {
  const row = unwrap(
    await db.rpc('record_production', {
      p_loom_id: p.loom_id,
      p_fabric_quality_id: p.fabric_quality_id ?? null,
      p_meters: p.meters ?? null,
      p_wasted_meters: p.wasted_meters ?? null,
      p_roll_length_m: p.roll_length_m ?? null,
      p_entry_date: p.entry_date ?? null,
      p_production_time: p.production_time ?? null,
      p_counter_reading: p.counter_reading ?? null,
      p_counter_reset: p.counter_reset ?? false,
      p_shift: p.shift ?? null,
      p_gsm: p.gsm ?? null,
      p_width_m: p.width_m ?? null,
      p_weighed_kg: p.weighed_kg ?? null,
      p_warp_kg: p.warp_kg ?? null,
      p_weft_kg: p.weft_kg ?? null,
      p_waste_kg: p.waste_kg ?? null,
      p_waste_pct: p.waste_pct ?? null,
      p_notes: p.notes ?? null,
      p_finish_beam: p.finish_beam,
      p_client_ref: p.client_ref ?? null,
      p_fabric_specification_id: p.fabric_specification_id ?? null,
    }),
  ) as { id: string };
  return unwrap(await db.from('v_takeoffs').select('*').eq('id', row.id).single()) as Takeoff & { roll_count: number };
}

export async function listRolls(db: Db, f: { productionId?: string; beamId?: string; limit?: number } = {}): Promise<FabricRoll[]> {
  let q = db.from('v_fabric_rolls').select('*');
  if (f.productionId) q = q.eq('production_id', f.productionId);
  if (f.beamId) q = q.eq('beam_id', f.beamId);
  return unwrap(await q.order('entry_date', { ascending: false }).order('roll_no').limit(f.limit ?? 500));
}

export async function listTakeoffs(
  db: Db,
  f: { beamId?: string; loomId?: string; factoryId?: string; limit?: number } = {},
): Promise<Takeoff[]> {
  let q = db.from('v_takeoffs').select('*');
  if (f.beamId) q = q.eq('beam_id', f.beamId);
  if (f.loomId) q = q.eq('loom_id', f.loomId);
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  // Actual time of the reading, newest first.
  return unwrap(await q.order('reading_at', { ascending: false }).order('created_at', { ascending: false }).limit(f.limit ?? 50));
}

/** Returns false when RLS hid the row (data entry cannot delete). */
export async function deleteTakeoff(db: Db, id: string): Promise<boolean> {
  const rows = unwrap(await db.from('grey_fabric_production').delete().eq('id', id).select('id'));
  return rows.length > 0;
}

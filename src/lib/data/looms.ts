import { unwrap } from '../errors';
import type { BeamSummary, LoomStatusRow, Takeoff } from '../types';
import type { TakeoffInput } from '../validation';
import type { Db } from './client';

export async function listLoomStatus(db: Db, f: { factoryId?: string; activeOnly?: boolean } = {}): Promise<LoomStatusRow[]> {
  let q = db.from('v_loom_status').select('*');
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  if (f.activeOnly ?? true) q = q.eq('active', true);
  return unwrap(await q.order('factory_code', { ascending: false }).order('sort_order').order('machine_no'));
}

export async function getLoomStatus(db: Db, loomId: string): Promise<LoomStatusRow | null> {
  return unwrap(await db.from('v_loom_status').select('*').eq('loom_id', loomId).maybeSingle());
}

/** Beams waiting to be loaded. */
export async function listPreparedBeams(db: Db): Promise<BeamSummary[]> {
  return unwrap(await db.from('v_beam_summary').select('*').eq('status', 'prepared').order('created_date').order('beam_no'));
}

export async function loadBeam(db: Db, beamId: string, loomId: string): Promise<void> {
  unwrap(await db.rpc('load_beam', { p_beam_id: beamId, p_loom_id: loomId }));
}

export async function finishBeam(db: Db, beamId: string): Promise<void> {
  unwrap(await db.rpc('finish_beam', { p_beam_id: beamId }));
}

/** Correction: take a beam off its loom before any fabric was recorded (supervisor/owner). */
export async function unloadBeam(db: Db, beamId: string): Promise<boolean> {
  const rows = unwrap(await db.from('beams').update({ status: 'prepared' }).eq('id', beamId).select('id'));
  return rows.length > 0;
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

export async function listTakeoffs(
  db: Db,
  f: { beamId?: string; loomId?: string; factoryId?: string; limit?: number } = {},
): Promise<Takeoff[]> {
  let q = db.from('v_takeoffs').select('*');
  if (f.beamId) q = q.eq('beam_id', f.beamId);
  if (f.loomId) q = q.eq('loom_id', f.loomId);
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  return unwrap(await q.order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(f.limit ?? 50));
}

/** Returns false when RLS hid the row (data entry cannot delete). */
export async function deleteTakeoff(db: Db, id: string): Promise<boolean> {
  const rows = unwrap(await db.from('grey_fabric_production').delete().eq('id', id).select('id'));
  return rows.length > 0;
}

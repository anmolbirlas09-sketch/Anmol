import { unwrap } from '../errors';
import type { BeamLoomEvent, BeamStatus, BeamSummary, ConsumptionLineView } from '../types';
import type { BeamRow, ConsumptionInput } from '../validation';
import type { Db } from './client';

export interface BeamFilters {
  status?: BeamStatus;
  factoryId?: string;
  /** Beam no / card no / quality / Spec ID */
  q?: string;
  loomId?: string;
  qualityId?: string;
}

export async function listBeams(db: Db, f: BeamFilters = {}): Promise<BeamSummary[]> {
  let q = db.from('v_beam_summary').select('*');
  if (f.status) q = q.eq('status', f.status);
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  if (f.loomId) q = q.eq('loom_id', f.loomId);
  if (f.qualityId) q = q.eq('fabric_quality_id', f.qualityId);
  const term = f.q?.replace(/[,()*%\\]/g, ' ').trim();
  if (term) {
    const card = /^(?:card-?)?(\d+)$/i.exec(term);
    q = q.or(`beam_no.ilike.*${term}*,fabric_quality_name.ilike.*${term}*,spec_code.ilike.*${term}*,machine_no.ilike.*${term}*${card ? `,card_no.eq.${card[1]}` : ''}`);
  }
  return unwrap(await q.order('register_date', { ascending: false }).order('card_no', { ascending: false }).limit(300));
}

/** Loading, unloading and finishing: oldest first for a beam, newest first for a loom. */
export async function listBeamEvents(db: Db, f: { beamId?: string; loomId?: string; limit?: number }): Promise<BeamLoomEvent[]> {
  let q = db.from('v_beam_loom_events').select('*');
  if (f.beamId) q = q.eq('beam_id', f.beamId);
  if (f.loomId) q = q.eq('loom_id', f.loomId);
  const asc = !f.loomId;
  return unwrap(await q.order('at', { ascending: asc }).order('seq', { ascending: asc }).limit(f.limit ?? 200));
}

export async function getBeamSummary(db: Db, id: string): Promise<BeamSummary | null> {
  return unwrap(await db.from('v_beam_summary').select('*').eq('beam_id', id).maybeSingle());
}

export async function getConsumptionLines(db: Db, beamId: string): Promise<ConsumptionLineView[]> {
  return unwrap(
    await db.from('v_consumption_lines').select('*').eq('beam_id', beamId).order('usage_type').order('created_at'),
  );
}

export async function countBeamsByStatus(db: Db): Promise<Record<BeamStatus, number>> {
  const statuses: BeamStatus[] = ['prepared', 'on_loom', 'finished'];
  const counts = await Promise.all(
    statuses.map(async (s) => {
      const res = await db.from('beams').select('id', { count: 'exact', head: true }).eq('status', s);
      if (res.error) unwrap(res);
      return res.count ?? 0;
    }),
  );
  return Object.fromEntries(statuses.map((s, i) => [s, counts[i]])) as Record<BeamStatus, number>;
}

/** Save a new beam card. Every field may be missing; the label is CARD-n when there is no beam number. */
export async function createBeam(db: Db, input: BeamRow): Promise<{ id: string; beam_no: string }> {
  const row = unwrap(await db.from('beams').insert(input).select('id, beam_no, card_no').single()) as { id: string; beam_no: string | null; card_no: number };
  return { id: row.id, beam_no: row.beam_no || `CARD-${row.card_no}` };
}

/** Edit a saved card (owner / supervisor). Blank fields are stored as NULL. Returns false when RLS hid the row. */
export async function updateBeam(db: Db, id: string, input: BeamRow): Promise<boolean> {
  const rows = unwrap(await db.from('beams').update(input).eq('id', id).select('id'));
  return rows.length > 0;
}

export async function addConsumption(db: Db, input: ConsumptionInput): Promise<{ id: string }> {
  return unwrap(await db.from('yarn_consumption').insert(input).select('id').single());
}

/** Returns false when RLS hid the row (e.g. data_entry users cannot delete). */
export async function deleteConsumption(db: Db, id: string): Promise<boolean> {
  const rows = unwrap(await db.from('yarn_consumption').delete().eq('id', id).select('id'));
  return rows.length > 0;
}

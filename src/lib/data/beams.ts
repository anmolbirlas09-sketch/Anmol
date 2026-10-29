import { unwrap } from '../errors';
import type { BeamStatus, BeamSummary, ConsumptionLineView } from '../types';
import type { BeamInput, ConsumptionInput } from '../validation';
import type { Db } from './client';

export interface BeamFilters {
  status?: BeamStatus;
  factoryId?: string;
  q?: string;
}

export async function listBeams(db: Db, f: BeamFilters = {}): Promise<BeamSummary[]> {
  let q = db.from('v_beam_summary').select('*');
  if (f.status) q = q.eq('status', f.status);
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  const term = f.q?.replace(/[,()*%\\]/g, ' ').trim();
  if (term) q = q.or(`beam_no.ilike.*${term}*,fabric_quality_name.ilike.*${term}*`);
  return unwrap(await q.order('created_date', { ascending: false }).order('beam_no', { ascending: false }).limit(300));
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

export async function createBeam(db: Db, input: BeamInput): Promise<{ id: string; beam_no: string }> {
  return unwrap(await db.from('beams').insert(input).select('id, beam_no').single());
}

export async function addConsumption(db: Db, input: ConsumptionInput): Promise<{ id: string }> {
  return unwrap(await db.from('yarn_consumption').insert(input).select('id').single());
}

/** Returns false when RLS hid the row (e.g. data_entry users cannot delete). */
export async function deleteConsumption(db: Db, id: string): Promise<boolean> {
  const rows = unwrap(await db.from('yarn_consumption').delete().eq('id', id).select('id'));
  return rows.length > 0;
}

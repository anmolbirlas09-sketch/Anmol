import { unwrap } from '../errors';
import type { Dispatch } from '../types';
import type { DispatchInput } from '../validation';
import type { Db } from './client';

export async function createDispatch(db: Db, input: DispatchInput): Promise<{ id: string }> {
  return unwrap(await db.from('grey_fabric_dispatch').insert(input).select('id').single());
}

export async function listDispatches(db: Db, f: { factoryId?: string; limit?: number } = {}): Promise<Dispatch[]> {
  let q = db.from('v_dispatches').select('*');
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  return unwrap(await q.order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(f.limit ?? 30));
}

/** Returns false when RLS hid the row (data entry cannot delete). */
export async function deleteDispatch(db: Db, id: string): Promise<boolean> {
  const rows = unwrap(await db.from('grey_fabric_dispatch').delete().eq('id', id).select('id'));
  return rows.length > 0;
}

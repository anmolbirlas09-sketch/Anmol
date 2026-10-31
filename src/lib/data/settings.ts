import { notAllowed, unwrap } from '../errors';
import type { AppUser, Factory, LoomRow } from '../types';
import type { Db } from './client';

export async function listUsers(db: Db): Promise<AppUser[]> {
  return unwrap(await db.from('app_users').select('id, name, email, role, factory_id, active').order('active', { ascending: false }).order('name'));
}

export async function updateUser(db: Db, id: string, v: Pick<AppUser, 'name' | 'role' | 'active'> & { factory_id?: string | null }): Promise<boolean> {
  const rows = unwrap(
    await db.from('app_users').update({ name: v.name, role: v.role, active: v.active, factory_id: v.factory_id ?? null }).eq('id', id).select('id'),
  );
  return rows.length > 0;
}

export async function listAllFactories(db: Db): Promise<(Factory & { active: boolean; sort_order: number })[]> {
  return unwrap(await db.from('factories').select('id, code, name, active, sort_order').order('sort_order'));
}

export async function saveFactory(db: Db, v: { code: string; name: string; active: boolean }, id?: string): Promise<void> {
  if (id) {
    const rows = unwrap(await db.from('factories').update(v).eq('id', id).select('id'));
    if (!rows.length) throw notAllowed();
  } else {
    const max = unwrap(await db.from('factories').select('sort_order').order('sort_order', { ascending: false }).limit(1)) as { sort_order: number }[];
    unwrap(await db.from('factories').insert({ ...v, sort_order: (max[0]?.sort_order ?? 0) + 1 }).select('id'));
  }
}

export async function listLooms(db: Db): Promise<LoomRow[]> {
  return unwrap(await db.from('looms').select('id, factory_id, machine_no, status, active, sort_order, notes, fabric_specification_id').order('sort_order').order('machine_no'));
}

export async function saveLoom(
  db: Db,
  v: { machine_no: string; factory_id: string; sort_order?: number; status?: string; active: boolean; notes?: string; fabric_specification_id?: string },
  id?: string,
): Promise<void> {
  const row: Record<string, unknown> = {
    machine_no: v.machine_no, factory_id: v.factory_id, active: v.active, notes: v.notes ?? null,
    fabric_specification_id: v.fabric_specification_id ?? null,
  };
  if (v.sort_order !== undefined) row.sort_order = v.sort_order;
  // 'running' is set by loading a beam, never by hand; idle <-> maintenance only.
  if (v.status === 'idle' || v.status === 'maintenance') row.status = v.status;
  if (id) {
    const rows = unwrap(await db.from('looms').update(row).eq('id', id).select('id'));
    if (!rows.length) throw notAllowed();
  } else {
    unwrap(await db.from('looms').insert(row).select('id'));
  }
}

export async function getVarianceThreshold(db: Db): Promise<number> {
  const row = unwrap(await db.from('app_settings').select('value').eq('key', 'variance_threshold_pct').maybeSingle()) as { value: number } | null;
  return Number(row?.value ?? 5);
}

export async function setVarianceThreshold(db: Db, pct: number): Promise<void> {
  const rows = unwrap(await db.from('app_settings').update({ value: pct }).eq('key', 'variance_threshold_pct').select('key'));
  if (!rows.length) throw notAllowed();
}

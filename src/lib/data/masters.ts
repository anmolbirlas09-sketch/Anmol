import { notAllowed, unwrap } from '../errors';
import type { Factory, FabricQualityView, Supplier, YarnQuality } from '../types';
import type { Db } from './client';

export async function listFactories(db: Db): Promise<Factory[]> {
  return unwrap(await db.from('factories').select('id, code, name').eq('active', true).order('sort_order'));
}

export async function listYarnQualities(db: Db, opts: { activeOnly?: boolean } = {}): Promise<YarnQuality[]> {
  let q = db.from('yarn_qualities').select('*').order('name');
  if (opts.activeOnly) q = q.eq('active', true);
  return unwrap(await q);
}

export async function getYarnQuality(db: Db, id: string): Promise<YarnQuality | null> {
  return unwrap(await db.from('yarn_qualities').select('*').eq('id', id).maybeSingle());
}

export async function listFabricQualities(db: Db, opts: { activeOnly?: boolean } = {}): Promise<FabricQualityView[]> {
  let q = db.from('v_fabric_qualities').select('*').order('name');
  if (opts.activeOnly) q = q.eq('active', true);
  return unwrap(await q);
}

export async function getFabricQuality(db: Db, id: string): Promise<FabricQualityView | null> {
  return unwrap(await db.from('v_fabric_qualities').select('*').eq('id', id).maybeSingle());
}

export async function listSuppliers(db: Db, opts: { activeOnly?: boolean } = {}): Promise<Supplier[]> {
  let q = db.from('suppliers').select('id, name, gstin, contact, phone, active').order('name');
  if (opts.activeOnly) q = q.eq('active', true);
  return unwrap(await q);
}

export async function getSupplier(db: Db, id: string): Promise<Supplier | null> {
  return unwrap(await db.from('suppliers').select('id, name, gstin, contact, phone, active').eq('id', id).maybeSingle());
}

type MasterTable = 'yarn_qualities' | 'fabric_qualities' | 'suppliers';

/** Insert (no id) or update (id) a master row; returns its id. */
export async function saveMaster(db: Db, table: MasterTable, values: Record<string, unknown>, id?: string): Promise<string> {
  // Optional fields left blank must be cleared on update, so send explicit nulls.
  const row = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === undefined ? null : v]));
  if (id) {
    const res = unwrap(await db.from(table as string).update(row).eq('id', id).select('id'));
    if (!res?.length) throw notAllowed();
    return id;
  }
  const created = unwrap(await db.from(table as string).insert(row).select('id').single()) as { id: string };
  return created.id;
}

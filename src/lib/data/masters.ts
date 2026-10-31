import { notAllowed, unwrap } from '../errors';
import type { Factory, FabricQualityView, FabricSpecification, Supplier, YarnQuality } from '../types';
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

// ---------------------------------------------------------------------------
// Fabric specifications (many per parent quality)
// ---------------------------------------------------------------------------

export async function listSpecifications(
  db: Db,
  f: { qualityId?: string; activeOnly?: boolean; q?: string } = {},
): Promise<FabricSpecification[]> {
  let q = db.from('v_fabric_specifications').select('*');
  if (f.qualityId) q = q.eq('fabric_quality_id', f.qualityId);
  if (f.activeOnly) q = q.eq('active', true);
  const term = f.q?.replace(/[,()*%\\]/g, ' ').trim();
  if (term) q = q.or(`spec_code.ilike.*${term}*,fabric_quality_name.ilike.*${term}*`);
  return unwrap(await q.order('fabric_quality_name').order('seq').limit(2000));
}

export async function getSpecification(db: Db, id: string): Promise<FabricSpecification | null> {
  return unwrap(await db.from('v_fabric_specifications').select('*').eq('id', id).maybeSingle());
}

export interface SpecificationInput {
  fabric_quality_id: string;
  reed: number;
  ends_per_inch: number;
  warp_yarn_quality_id: string;
  weft_yarn_quality_id: string;
  active: boolean;
  notes?: string;
}

/** Create (no id: the database assigns the Specification ID) or edit a specification; returns its id. */
export async function saveSpecification(db: Db, v: SpecificationInput, id?: string): Promise<string> {
  const row = {
    reed: v.reed, ends_per_inch: v.ends_per_inch, warp_yarn_quality_id: v.warp_yarn_quality_id,
    weft_yarn_quality_id: v.weft_yarn_quality_id, active: v.active, notes: v.notes ?? null,
  };
  if (id) {
    const rows = unwrap(await db.from('fabric_specifications').update(row).eq('id', id).select('id'));
    if (!rows?.length) throw notAllowed();
    return id;
  }
  // seq and spec_code are filled in by the database trigger
  const created = unwrap(
    await db.from('fabric_specifications').insert({ ...row, fabric_quality_id: v.fabric_quality_id, seq: 0, spec_code: '' }).select('id').single(),
  ) as { id: string };
  return created.id;
}

import { unwrap } from '../errors';
import type { YarnLotBalance, YarnLedgerRow, YarnStockByQuality } from '../types';
import type { YarnLotInput } from '../validation';
import type { Db } from './client';

export interface LotFilters {
  q?: string;
  qualityId?: string;
  factoryId?: string;
  includeEmpty?: boolean;
}

/** PostgREST `or` filters treat , ( ) as syntax: strip them from free text. */
const searchTerm = (s: string) => s.replace(/[,()*%\\]/g, ' ').trim();

export async function listLotBalances(db: Db, f: LotFilters = {}): Promise<YarnLotBalance[]> {
  let q = db.from('v_yarn_lot_balance').select('*');
  if (f.qualityId) q = q.eq('yarn_quality_id', f.qualityId);
  if (f.factoryId) q = q.eq('factory_id', f.factoryId);
  if (!f.includeEmpty) q = q.gt('balance_kg', 0);
  const term = f.q ? searchTerm(f.q) : '';
  if (term) {
    q = q.or(['lot_no', 'yarn_quality_name', 'supplier_name', 'challan_no'].map((c) => `${c}.ilike.*${term}*`).join(','));
  }
  return unwrap(await q.order('inward_date', { ascending: false }).order('lot_no').limit(500));
}

/** Lots that still have stock — what can be consumed on a beam. */
export async function listOpenLots(db: Db): Promise<YarnLotBalance[]> {
  return unwrap(await db.from('v_yarn_lot_balance').select('*').gt('balance_kg', 0).order('inward_date').order('lot_no'));
}

export async function getLotBalance(db: Db, id: string): Promise<YarnLotBalance | null> {
  return unwrap(await db.from('v_yarn_lot_balance').select('*').eq('yarn_lot_id', id).maybeSingle());
}

export async function getLotLedger(db: Db, id: string): Promise<YarnLedgerRow[]> {
  return unwrap(
    await db.from('v_yarn_ledger').select('*').eq('yarn_lot_id', id).order('entry_date').order('created_at'),
  );
}

export async function yarnStockByQuality(db: Db): Promise<YarnStockByQuality[]> {
  return unwrap(await db.from('v_yarn_stock_by_quality').select('*').order('yarn_quality_name'));
}

export async function createLot(db: Db, input: YarnLotInput): Promise<{ id: string; lot_no: string }> {
  return unwrap(await db.from('yarn_lots').insert(input).select('id, lot_no').single());
}

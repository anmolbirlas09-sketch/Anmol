// Phase 2 data layer, exercised exactly as the app calls it: supabase-js →
// (fake) Supabase gateway → Postgres with RLS, signed in as real users.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addConsumption, countBeamsByStatus, createBeam, deleteConsumption, getBeamSummary, getConsumptionLines, listBeams } from '@/lib/data/beams';
import type { Db } from '@/lib/data/client';
import { listFabricQualities, listFactories, listSuppliers, listYarnQualities, saveMaster } from '@/lib/data/masters';
import { createLot, getLotBalance, getLotLedger, listLotBalances, listOpenLots, yarnStockByQuality } from '@/lib/data/yarn';
import { DataError, friendlyError } from '@/lib/errors';
import { freshDb, type TestDb } from '../db/db';
import { startFakeSupabase, type FakeSupabase } from '../stack/fake-supabase';

let db: TestDb;
let gw: FakeSupabase;
let owner: Db, sup76: Db, entry76: Db;
const id: Record<string, string> = {};

async function signIn(email: string): Promise<Db> {
  const c = createClient(gw.url, gw.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  return c;
}

async function expectDbError(p: Promise<unknown>): Promise<DataError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return e as DataError;
  }
  throw new Error('expected an error');
}

beforeAll(async () => {
  db = await freshDb();
  gw = await startFakeSupabase({ databaseUrl: db.url });
  await db.createUser({ email: 'owner@test.local', role: 'owner', name: 'Owner' });
  await db.createUser({ email: 'sup76@test.local', role: 'supervisor', factoryCode: 'L-76', name: 'Sup 76' });
  await db.createUser({ email: 'entry76@test.local', role: 'data_entry', factoryCode: 'L-76', name: 'Entry 76' });
  [owner, sup76, entry76] = await Promise.all(['owner', 'sup76', 'entry76'].map((u) => signIn(`${u}@test.local`)));

  const factories = await listFactories(owner);
  id['L-76'] = factories.find((f) => f.code === 'L-76')!.id;
  id['L-75'] = factories.find((f) => f.code === 'L-75')!.id;
  const yq = await listYarnQualities(owner);
  id.white = yq.find((q) => q.name === 'Mono 0.25 White')!.id;
  id.black = yq.find((q) => q.name === 'Mono 0.25 Black')!.id;
  const fq = await listFabricQualities(owner);
  id['Mono White'] = fq.find((q) => q.name === 'Mono White')!.id;
  id['White/Black'] = fq.find((q) => q.name === 'White/Black')!.id;
});

afterAll(async () => {
  await gw?.close();
  await db?.close();
});

describe('masters', () => {
  it('lists factories in order and fabric qualities with their yarn names', async () => {
    expect((await listFactories(entry76)).map((f) => f.code)).toEqual(['L-76', 'L-75']);
    const wb = (await listFabricQualities(entry76)).find((q) => q.name === 'White/Black')!;
    expect([wb.warp_yarn_quality_name, wb.weft_yarn_quality_name, wb.weft_denier]).toEqual(['Mono 0.25 White', 'Mono 0.25 Black', 420]);
  });

  it('supervisor adds and edits a supplier; data entry cannot', async () => {
    const sid = await saveMaster(sup76, 'suppliers', { name: 'Navsari Yarns', gstin: '24ABCDE1234F1Z5', active: true });
    await saveMaster(sup76, 'suppliers', { name: 'Navsari Yarns', gstin: undefined, contact: 'Ravi', active: true }, sid);
    const s = (await listSuppliers(owner)).find((x) => x.id === sid)!;
    expect([s.gstin, s.contact]).toEqual([null, 'Ravi']);

    const err = await expectDbError(saveMaster(entry76, 'suppliers', { name: 'Nope', active: true }));
    expect(friendlyError(err)).toBe('You do not have permission to do this.');
  });

  it('a duplicate name is reported clearly', async () => {
    const err = await expectDbError(saveMaster(owner, 'yarn_qualities', { name: 'mono 0.25 white', reorder_level_kg: 0, active: true }));
    expect(friendlyError(err)).toBe('This yarn quality already exists');
  });
});

describe('yarn inward', () => {
  it('data entry records lots; balances and stock by quality update', async () => {
    const a = await createLot(entry76, {
      lot_no: 'A-101', yarn_quality_id: id.white, factory_id: id['L-76'], inward_date: '2026-10-20', kgs_received: 1000, challan_no: 'CH-9',
    });
    expect(a.lot_no).toBe('A-101');
    id['A-101'] = a.id;
    id['B-202'] = (await createLot(owner, { lot_no: 'B-202', yarn_quality_id: id.black, factory_id: id['L-75'], inward_date: '2026-10-21', kgs_received: 500 })).id;

    const lot = (await getLotBalance(entry76, id['A-101']))!;
    expect([lot.balance_kg, lot.yarn_quality_name, lot.factory_code]).toEqual([1000, 'Mono 0.25 White', 'L-76']);
    const white = (await yarnStockByQuality(entry76)).find((s) => s.yarn_quality_id === id.white)!;
    expect([white.balance_kg, white.is_low_stock]).toEqual([1000, false]);
  });

  it('L-76 staff cannot record a lot for L-75', async () => {
    const err = await expectDbError(
      createLot(entry76, { lot_no: 'X-1', yarn_quality_id: id.white, factory_id: id['L-75'], inward_date: '2026-10-21', kgs_received: 1 }),
    );
    expect(err.db.code).toBe('42501');
  });

  it('duplicate lot numbers are rejected case-insensitively', async () => {
    const err = await expectDbError(
      createLot(owner, { lot_no: 'a-101', yarn_quality_id: id.white, factory_id: id['L-76'], inward_date: '2026-10-21', kgs_received: 1 }),
    );
    expect(friendlyError(err)).toBe('This lot no already exists');
  });

  it('filters and searches the lot list', async () => {
    expect((await listLotBalances(entry76)).map((l) => l.lot_no)).toEqual(['B-202', 'A-101']); // newest first
    expect((await listLotBalances(entry76, { factoryId: id['L-75'] })).map((l) => l.lot_no)).toEqual(['B-202']);
    expect((await listLotBalances(entry76, { qualityId: id.white })).map((l) => l.lot_no)).toEqual(['A-101']);
    expect((await listLotBalances(entry76, { q: 'black' })).map((l) => l.lot_no)).toEqual(['B-202']);
    expect((await listLotBalances(entry76, { q: 'ch-9' })).map((l) => l.lot_no)).toEqual(['A-101']);
    expect((await listLotBalances(entry76, { q: 'a-1,(01)' })).length).toBe(0); // PostgREST syntax chars are stripped safely
  });
});

describe('beams and consumption', () => {
  it('creates beams and records warp/weft from several lots (§8 steps 2–4)', async () => {
    id['B-001'] = (await createBeam(entry76, { beam_no: 'B-001', fabric_quality_id: id['Mono White'], factory_id: id['L-76'], warp_length_m: 3000, created_date: '2026-10-22' })).id;
    id['B-002'] = (await createBeam(owner, { beam_no: 'B-002', fabric_quality_id: id['White/Black'], factory_id: id['L-75'], warp_length_m: 2000, created_date: '2026-10-22' })).id;

    await addConsumption(entry76, { beam_id: id['B-001'], yarn_lot_id: id['A-101'], usage_type: 'warp', kgs: 400, entry_date: '2026-10-22' });
    await addConsumption(entry76, { beam_id: id['B-001'], yarn_lot_id: id['A-101'], usage_type: 'weft', kgs: 300, entry_date: '2026-10-22' });
    expect((await getLotBalance(entry76, id['A-101']))!.balance_kg).toBe(300);

    await addConsumption(owner, { beam_id: id['B-002'], yarn_lot_id: id['A-101'], usage_type: 'warp', kgs: 250, entry_date: '2026-10-22' });
    await addConsumption(owner, { beam_id: id['B-002'], yarn_lot_id: id['B-202'], usage_type: 'weft', kgs: 200, entry_date: '2026-10-22' });
    expect((await getLotBalance(owner, id['A-101']))!.balance_kg).toBe(50);
    expect((await getLotBalance(owner, id['B-202']))!.balance_kg).toBe(300);

    const err = await expectDbError(
      addConsumption(owner, { beam_id: id['B-002'], yarn_lot_id: id['A-101'], usage_type: 'warp', kgs: 100, entry_date: '2026-10-22' }),
    );
    expect(err.db.code).toBe('WV001');
    expect(friendlyError(err)).toBe('Not enough yarn in lot A-101 — only 50.000 kg available.');
  });

  it('beam summary shows actual vs planned and the lines with lot and person', async () => {
    const b = (await getBeamSummary(entry76, id['B-001']))!;
    expect([b.warp_kg, b.weft_kg, b.total_yarn_kg, b.planned_warp_kg, b.status]).toEqual([400, 300, 700, 259.56, 'prepared']);
    expect(b.warp_variance_flag).toBe(true);

    const lines = await getConsumptionLines(entry76, id['B-001']);
    expect(lines.map((l) => [l.usage_type, l.lot_no, l.kgs, l.created_by_name])).toEqual([
      ['warp', 'A-101', 400, 'Entry 76'],
      ['weft', 'A-101', 300, 'Entry 76'],
    ]);
  });

  it('open lots exclude used-up lots; lot ledger lists every movement', async () => {
    await createLot(owner, { lot_no: 'C-303', yarn_quality_id: id.white, factory_id: id['L-76'], inward_date: '2026-10-23', kgs_received: 10 });
    const cid = (await listLotBalances(owner, { q: 'C-303' }))[0].yarn_lot_id;
    await addConsumption(owner, { beam_id: id['B-001'], yarn_lot_id: cid, usage_type: 'warp', kgs: 10, entry_date: '2026-10-23' });
    expect((await listOpenLots(entry76)).map((l) => l.lot_no)).toEqual(['A-101', 'B-202']);
    expect((await listLotBalances(entry76, { includeEmpty: true })).map((l) => l.lot_no)).toContain('C-303');

    // L-76 staff see every movement on the lot (so it sums to the balance) but not the L-75 beam's number.
    const ledger = await getLotLedger(entry76, id['A-101']);
    expect(ledger.map((r) => [r.movement_type, r.beam_no, r.kgs])).toEqual([
      ['inward', null, 1000],
      ['warp', 'B-001', -400],
      ['weft', 'B-001', -300],
      ['warp', null, -250],
    ]);
    expect(ledger.reduce((s, r) => s + r.kgs, 0)).toBe((await getLotBalance(entry76, id['A-101']))!.balance_kg);
    expect((await getLotLedger(owner, id['A-101']))[3].beam_no).toBe('B-002');
  });

  it('L-76 staff only see L-76 beams; list filters by status and search', async () => {
    expect((await listBeams(entry76)).map((b) => b.beam_no)).toEqual(['B-001']);
    expect((await listBeams(owner)).map((b) => b.beam_no)).toEqual(['B-002', 'B-001']);
    expect((await listBeams(owner, { q: 'black' })).map((b) => b.beam_no)).toEqual(['B-002']);
    expect((await listBeams(owner, { status: 'on_loom' })).length).toBe(0);
    expect(await countBeamsByStatus(owner)).toEqual({ prepared: 2, on_loom: 0, finished: 0 });
    expect(await countBeamsByStatus(entry76)).toEqual({ prepared: 1, on_loom: 0, finished: 0 });
  });

  it('L-76 staff cannot add yarn to an L-75 beam', async () => {
    const err = await expectDbError(
      addConsumption(sup76, { beam_id: id['B-002'], yarn_lot_id: id['A-101'], usage_type: 'warp', kgs: 1, entry_date: '2026-10-22' }),
    );
    expect(err.db.code).toBe('42501');
  });

  it('data entry cannot delete a line; supervisor can, and stock comes back', async () => {
    const [warp] = await getConsumptionLines(sup76, id['B-001']);
    expect(await deleteConsumption(entry76, warp.id)).toBe(false);
    expect(await deleteConsumption(sup76, warp.id)).toBe(true);
    expect((await getLotBalance(sup76, id['A-101']))!.balance_kg).toBe(450);
  });
});

describe('auth', () => {
  it('rejects a wrong password and anonymous reads', async () => {
    const c = createClient(gw.url, gw.anonKey, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email: 'owner@test.local', password: 'nope' });
    expect(error?.message).toBe('Invalid login credentials');
    const anon = await c.from('v_yarn_lot_balance').select('*');
    expect(anon.error?.code).toBe('42501');
  });
});

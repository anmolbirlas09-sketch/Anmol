// Phase 5 data layer: the complete §8 acceptance test through the app's own
// functions (dispatch included), reports, opening-stock import, adjustments and
// owner-only settings — all through supabase-js with RLS.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGreyAdjustment, createYarnAdjustment } from '@/lib/data/adjustments';
import { addConsumption, createBeam, getBeamSummary } from '@/lib/data/beams';
import type { Db } from '@/lib/data/client';
import { createDispatch, deleteDispatch, listDispatches } from '@/lib/data/dispatch';
import { greyStock } from '@/lib/data/grey';
import { importGreyRows, importMasters, importYarnRows } from '@/lib/data/imports';
import { finishBeam, getLoomStatus, listLoomStatus, loadBeam, recordTakeoff } from '@/lib/data/looms';
import { listFabricQualities, listFactories, listSpecifications, listYarnQualities } from '@/lib/data/masters';
import { listLooms, listUsers, saveLoom, setVarianceThreshold, updateUser } from '@/lib/data/settings';
import { createLot, getLotBalance } from '@/lib/data/yarn';
import { DataError, friendlyError } from '@/lib/errors';
import { todayIST } from '@/lib/format';
import { parseWorkbook, readWorkbook, templateWorkbook, SHEET_NAME } from '@/lib/importer';
import { buildReport } from '@/lib/reports/build';
import { freshDb, type TestDb } from '../db/db';
import { startFakeSupabase, type FakeSupabase } from '../stack/fake-supabase';

let db: TestDb;
let gw: FakeSupabase;
let owner: Db, sup76: Db, entry76: Db;
const id: Record<string, string> = {};
const today = todayIST();
const sum = (rows: Record<string, unknown>[], k: string) => Math.round(rows.reduce((s, r) => s + Number(r[k]), 0) * 1000) / 1000;

async function signIn(email: string): Promise<Db> {
  const c = createClient(gw.url, gw.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  return c;
}
async function dbError(p: Promise<unknown>): Promise<DataError> {
  try {
    await p;
  } catch (e) {
    return e as DataError;
  }
  throw new Error('expected an error');
}
const greyTotal = async (c: Db) => {
  const rows = await greyStock(c);
  return { m: sum(rows as never, 'stock_m'), kg: sum(rows as never, 'stock_kg') };
};

beforeAll(async () => {
  db = await freshDb();
  gw = await startFakeSupabase({ databaseUrl: db.url });
  id.owner = await db.createUser({ email: 'owner@test.local', role: 'owner' });
  id.sup76 = await db.createUser({ email: 'sup76@test.local', role: 'supervisor', factoryCode: 'L-76' });
  id.entry76 = await db.createUser({ email: 'entry76@test.local', role: 'data_entry', factoryCode: 'L-76' });
  [owner, sup76, entry76] = await Promise.all(['owner', 'sup76', 'entry76'].map((u) => signIn(`${u}@test.local`)));
  for (const f of await listFactories(owner)) id[f.code] = f.id;
  for (const q of await listYarnQualities(owner)) id[q.name] = q.id;
  for (const q of await listFabricQualities(owner)) id[`fq:${q.name}`] = q.id;
  for (const sp of await listSpecifications(owner)) id[`spec:${sp.fabric_quality_name}`] = sp.id;
  for (const l of await listLoomStatus(owner)) id[l.machine_no] = l.loom_id;
});

afterAll(async () => {
  await gw?.close();
  await db?.close();
});

describe('§8 acceptance, end to end through the app’s data layer', () => {
  it('1–3. inward and consumption', async () => {
    id['A-101'] = (await createLot(owner, { lot_no: 'A-101', yarn_quality_id: id['Mono 0.25 White'], factory_id: id['L-76'], inward_date: today, kgs_received: 1000 })).id;
    id['B-202'] = (await createLot(owner, { lot_no: 'B-202', yarn_quality_id: id['Mono 0.25 Black'], factory_id: id['L-75'], inward_date: today, kgs_received: 500 })).id;
    id['B-001'] = (await createBeam(owner, { beam_no: 'B-001', fabric_quality_id: id['fq:Mono White'], factory_id: id['L-76'], warp_length_m: 3000, created_date: today })).id;
    await addConsumption(owner, { beam_id: id['B-001'], yarn_lot_id: id['A-101'], usage_type: 'warp', kgs: 400, entry_date: today });
    await addConsumption(owner, { beam_id: id['B-001'], yarn_lot_id: id['A-101'], usage_type: 'weft', kgs: 300, entry_date: today });
    expect((await getLotBalance(owner, id['A-101']))!.balance_kg).toBe(300);
    id['B-002'] = (await createBeam(owner, { beam_no: 'B-002', fabric_quality_id: id['fq:White/Black'], factory_id: id['L-75'], warp_length_m: 2000, created_date: today })).id;
    await addConsumption(owner, { beam_id: id['B-002'], yarn_lot_id: id['A-101'], usage_type: 'warp', kgs: 250, entry_date: today });
    await addConsumption(owner, { beam_id: id['B-002'], yarn_lot_id: id['B-202'], usage_type: 'weft', kgs: 200, entry_date: today });
    expect([(await getLotBalance(owner, id['A-101']))!.balance_kg, (await getLotBalance(owner, id['B-202']))!.balance_kg]).toEqual([50, 300]);
  });

  it('4. over-drawing A-101 is blocked, showing 50 kg available', async () => {
    const e = await dbError(addConsumption(owner, { beam_id: id['B-002'], yarn_lot_id: id['A-101'], usage_type: 'warp', kgs: 100, entry_date: today }));
    expect(friendlyError(e)).toBe('Not enough yarn in lot A-101 — only 50.000 kg available.');
  });

  it('5. loading, with the double-load blocked → 2 running, 66 idle', async () => {
    await loadBeam(owner, id['B-001'], id['L76-05']);
    expect((await dbError(loadBeam(owner, id['B-002'], id['L76-05']))).db.code).toBe('WV002');
    await loadBeam(owner, id['B-002'], id['L75-12']);
    const looms = await listLoomStatus(owner);
    expect([looms.filter((l) => l.status === 'running').length, looms.filter((l) => l.status === 'idle').length]).toEqual([2, 66]);
  });

  it('6. take-offs → grey 2,000 m / 1,070 kg', async () => {
    await recordTakeoff(owner, { loom_id: id['L76-05'], meters: 1200, kgs: 650, entry_date: today, finish_beam: false });
    await recordTakeoff(owner, { loom_id: id['L75-12'], meters: 800, kgs: 420, entry_date: today, finish_beam: false });
    expect(await greyTotal(owner)).toEqual({ m: 2000, kg: 1070 });
  });

  it('7. B-001: no wastage recorded → 0 m wasted and no KG wastage (yarn − fabric is not wastage)', async () => {
    const b = (await getBeamSummary(owner, id['B-001']))!;
    expect([b.wasted_meters, b.wastage_pct, b.waste_kg_actual, b.waste_kg_estimated]).toEqual([0, 0, null, null]);
  });

  it('8. dispatch 500 m / 270 kg of Mono White → grey 1,500 m / 800 kg', async () => {
    await createDispatch(entry76, { fabric_quality_id: id['fq:Mono White'], factory_id: id['L-76'], entry_date: today, meters: 500, kgs: 270, party: 'Test Party', challan_no: 'DC-1' });
    expect(await greyTotal(owner)).toEqual({ m: 1500, kg: 800 });
    const d = await listDispatches(entry76);
    expect(d.map((x) => [x.fabric_quality_name, x.factory_code, x.meters, x.kgs, x.party])).toEqual([['Mono White', 'L-76', 500, 270, 'Test Party']]);
  });

  it('9. finishing B-001 frees L76-05', async () => {
    await finishBeam(owner, id['B-001']);
    expect((await getLoomStatus(owner, id['L76-05']))!.status).toBe('idle');
  });
});

describe('dispatch rules', () => {
  it('cannot dispatch more than is in stock at that factory', async () => {
    const e = await dbError(createDispatch(owner, { fabric_quality_id: id['fq:Mono White'], factory_id: id['L-76'], entry_date: today, meters: 701, kgs: 1 }));
    expect(e.db.code).toBe('WV003');
    expect(friendlyError(e)).toBe('Not enough grey stock of Mono White · MONOWHITE-S1 at L-76: 700.00 m / 380.000 kg available');
    // White/Black is at L-75 only
    expect((await dbError(createDispatch(owner, { fabric_quality_id: id['fq:White/Black'], factory_id: id['L-76'], entry_date: today, meters: 1, kgs: 1 }))).db.code).toBe('WV003');
  });

  it('L-76 staff cannot dispatch from L-75; data entry cannot delete a dispatch, supervisor can', async () => {
    expect((await dbError(createDispatch(entry76, { fabric_quality_id: id['fq:White/Black'], factory_id: id['L-75'], entry_date: today, meters: 1, kgs: 1 }))).db.code).toBe('42501');
    const d = await createDispatch(sup76, { fabric_quality_id: id['fq:Mono White'], factory_id: id['L-76'], entry_date: today, meters: 10, kgs: 5 });
    expect(await deleteDispatch(entry76, d.id)).toBe(false);
    expect(await deleteDispatch(sup76, d.id)).toBe(true);
  });
});

describe('reports', () => {
  const p = () => ({ from: today.slice(0, 8) + '01', to: today, period: 'day' as const });

  it('yarn by quality: inward, warp, weft, closing', async () => {
    const r = await buildReport(owner, 'yarn-quality', p());
    const white = r.rows.find((x) => x.yarn_quality_name === 'Mono 0.25 White')!;
    expect([white.inward_kg, white.warp_kg, white.weft_kg, white.closing_kg]).toEqual([1000, 650, 300, 50]);
    expect(r.totals).toMatchObject({ yarn_quality_name: 'Total', inward_kg: 1500, closing_kg: 350 });
  });

  it('yarn by lot', async () => {
    const r = await buildReport(owner, 'yarn-lot', p());
    expect(r.rows.map((x) => [x.lot_no, x.closing_kg])).toEqual([['A-101', 50], ['B-202', 300]]);
  });

  it('opening balance = movements before the period', async () => {
    const r = await buildReport(owner, 'yarn-quality', { from: '2099-01-01', to: '2099-12-31', period: 'day' });
    const white = r.rows.find((x) => x.yarn_quality_name === 'Mono 0.25 White')!;
    expect([white.opening_kg, white.inward_kg, white.closing_kg]).toEqual([50, 0, 50]);
  });

  it('beam register and variance', async () => {
    const reg = await buildReport(owner, 'beam-register', p());
    expect(reg.rows.map((x) => [x.beam_no, x.machine_no, x.yarn_issued, x.meters, x.wasted_meters, x.net_meters, x.wastage_pct, x.kgs, x.waste_kg])).toEqual([
      ['B-001', 'L76-05', 700, 1200, 0, 1200, 0, 650, null],
      ['B-002', 'L75-12', 450, 800, 0, 800, 0, 420, null],
    ]);
    expect(reg.totals).toMatchObject({ meters: 2000, wasted_meters: 0, wastage_pct: 0, waste_kg: null });
    const v = await buildReport(owner, 'variance', p());
    expect(v.rows[0]).toMatchObject({ beam_no: 'B-001', planned_warp_kg: 259.56, warp_kg: 400, warp_variance_pct: 54.11, flag: true });
    expect(v.flagged).toEqual([true, true]);
  });

  it('loom-wise production, daily and monthly, by factory', async () => {
    const daily = await buildReport(owner, 'loom-production', p());
    expect(daily.rows.map((x) => [x.machine_no, x.meters, x.kgs])).toEqual([['L76-05', 1200, 650], ['L75-12', 800, 420]]);
    const monthly = await buildReport(owner, 'loom-production', { ...p(), period: 'month', factoryId: id['L-75'], factoryCode: 'L-75' });
    expect(monthly.rows.map((x) => [x.period, x.machine_no, x.meters])).toEqual([[today.slice(0, 8) + '01', 'L75-12', 800]]);
    expect(monthly.subtitle).toContain('L-75');
  });

  it('grey summary: produced, dispatched, closing', async () => {
    const r = await buildReport(owner, 'grey-summary', p());
    expect(r.rows.map((x) => [x.fabric_quality_name, x.factory_code, x.produced_m, x.dispatched_m, x.closing_m, x.closing_kg])).toEqual([
      ['Mono White', 'L-76', 1200, 500, 700, 380],
      ['White/Black', 'L-75', 800, 0, 800, 420],
    ]);
  });

  it('factory staff reports only contain their factory', async () => {
    const r = await buildReport(entry76, 'grey-summary', p());
    expect(r.rows.map((x) => x.factory_code)).toEqual(['L-76']);
  });

  it('pages through more rows than one API page', async () => {
    // 1,200 tiny lots → more than the 1,000-row page size
    await db.sql.query(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received, inward_date)
                        select 'BULK-' || g, $1, $2, 1, $3 from generate_series(1, 1200) g`, [id['Mono 0.30 Green'], id['L-76'], today]);
    const r = await buildReport(owner, 'yarn-lot', p());
    expect(r.rows.length).toBe(1202);
    expect(r.rows.find((x) => x.lot_no === 'BULK-1200')).toBeTruthy();
  });
});

describe('opening stock import', () => {
  async function file(kind: 'yarn' | 'grey', rows: unknown[][]) {
    const m = await importMasters(owner, null);
    const wb = templateWorkbook(kind, m);
    for (const r of rows) wb.getWorksheet(SHEET_NAME[kind])!.addRow(r);
    return readWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  it('imports opening yarn lots, which then behave like any lot', async () => {
    const m = await importMasters(sup76, id['L-76']);
    const parsed = parseWorkbook(await file('yarn', [['OP-1', 'Mono 0.25 White', 'L-76', 250.5, '01-10-2026'], ['OP-2', 'Mono 0.25 Black', 'L-76', 100]]), 'yarn', m, today);
    expect(parsed.errors).toEqual([]);
    expect(await importYarnRows(sup76, parsed.rows as never)).toBe(2);
    const lot = (await (await import('@/lib/data/yarn')).listLotBalances(owner, { q: 'OP-1' }))[0];
    expect([lot.balance_kg, lot.is_opening, lot.inward_date]).toEqual([250.5, true, '2026-10-01']);
  });

  it('existing lots are caught by the checker; a clash slipping through fails the whole batch', async () => {
    const m = await importMasters(owner, null);
    const parsed = parseWorkbook(await file('yarn', [['op-1', 'Mono 0.25 White', 'L-76', 1]]), 'yarn', m, today);
    expect(parsed.errors).toEqual([{ row: 2, message: 'Lot OP-1 already exists' }]);
    // Race: someone creates OP-9 between check and import → nothing is imported.
    const ok = parseWorkbook(await file('yarn', [['OP-8', 'Mono 0.25 White', 'L-76', 1], ['OP-9', 'Mono 0.25 White', 'L-76', 1]]), 'yarn', m, today);
    await createLot(owner, { lot_no: 'OP-9', yarn_quality_id: id['Mono 0.25 White'], factory_id: id['L-76'], inward_date: today, kgs_received: 1 });
    expect(friendlyError(await dbError(importYarnRows(owner, ok.rows as never)))).toBe('This lot no already exists');
    expect((await (await import('@/lib/data/yarn')).listLotBalances(owner, { q: 'OP-8' })).length).toBe(0);
  });

  it('imports opening grey stock as dispatchable stock', async () => {
    const m = await importMasters(owner, null);
    const parsed = parseWorkbook(await file('grey', [['Green Shade Net', '', 'L-75', 3000, 1500, '01-10-2026']]), 'grey', m, today);
    expect(parsed.errors).toEqual([]);
    await importGreyRows(owner, parsed.rows as never);
    const rows = await greyStock(owner, { factoryId: id['L-75'] });
    expect(rows.find((r) => r.fabric_quality_name === 'Green Shade Net')).toMatchObject({ adjusted_m: 3000, stock_m: 3000, stock_kg: 1500 });
    await createDispatch(owner, { fabric_quality_id: id['fq:Green Shade Net'], factory_id: id['L-75'], entry_date: today, meters: 1000, kgs: 500 });
  });

  it('data entry cannot import grey stock (adjustments need a supervisor)', async () => {
    const e = await dbError(importGreyRows(entry76, [{ row: 2, fabric_quality_id: id['fq:Mono White'], fabric_quality_name: 'Mono White', fabric_specification_id: id['spec:Mono White'], spec_code: 'MONOWHITE-S1', factory_id: id['L-76'], factory_code: 'L-76', meters: 1, kgs: 1, entry_date: today }]));
    expect(e.db.code).toBe('42501');
  });
});

describe('adjustments', () => {
  it('supervisor adjusts a yarn lot; cannot overdraw; data entry cannot adjust', async () => {
    await createYarnAdjustment(sup76, { yarn_lot_id: id['A-101'], kgs: -5, reason: 'Moisture loss', entry_date: today });
    expect((await getLotBalance(owner, id['A-101']))!.balance_kg).toBe(45);
    expect(friendlyError(await dbError(createYarnAdjustment(sup76, { yarn_lot_id: id['A-101'], kgs: -46, reason: 'x', entry_date: today })))).toBe(
      'Not enough yarn in lot A-101 — only 45.000 kg available.',
    );
    expect((await dbError(createYarnAdjustment(entry76, { yarn_lot_id: id['A-101'], kgs: 1, reason: 'x', entry_date: today }))).db.code).toBe('42501');
  });

  it('grey adjustment by meters and kg', async () => {
    await createGreyAdjustment(sup76, { fabric_quality_id: id['fq:Mono White'], factory_id: id['L-76'], meters: -2, kgs: -1, reason: 'Physical count', entry_date: today });
    const mw = (await greyStock(owner)).find((r) => r.fabric_quality_name === 'Mono White')!;
    expect([mw.stock_m, mw.stock_kg]).toEqual([698, 379]);
  });
});

describe('settings are owner-only', () => {
  it('owner activates a new user and sets role + factory; others cannot', async () => {
    await db.sql.query(`insert into auth.users (email, raw_user_meta_data) values ('new@test.local', '{"name":"Naya"}')`);
    const naya = (await listUsers(owner)).find((u) => u.email === 'new@test.local')!;
    expect([naya.role, naya.active]).toEqual(['data_entry', false]);
    expect(await updateUser(sup76, naya.id, { name: 'Naya', role: 'supervisor', active: true })).toBe(false);
    expect(await updateUser(owner, naya.id, { name: 'Naya Bhai', role: 'supervisor', active: true, factory_id: id['L-75'] })).toBe(true);
    const after = (await listUsers(owner)).find((u) => u.id === naya.id)!;
    expect([after.name, after.role, after.active, after.factory_id]).toEqual(['Naya Bhai', 'supervisor', true, id['L-75']]);
  });

  it('owner renames, deactivates, puts in maintenance and adds looms; running looms are protected', async () => {
    const l = (await listLooms(owner)).find((x) => x.machine_no === 'L76-36')!;
    await saveLoom(owner, { machine_no: 'L76-36A', factory_id: l.factory_id, active: true, status: 'maintenance' }, l.id);
    await saveLoom(owner, { machine_no: 'L76-37', factory_id: id['L-76'], active: true, sort_order: 37 });
    const looms = await listLooms(owner);
    expect(looms.find((x) => x.id === l.id)).toMatchObject({ machine_no: 'L76-36A', status: 'maintenance' });
    expect(looms.find((x) => x.machine_no === 'L76-37')).toMatchObject({ status: 'idle', active: true });
    expect(friendlyError(await dbError(saveLoom(owner, { machine_no: 'L75-12', factory_id: id['L-75'], active: false }, id['L75-12'])))).toBe(
      'Loom L75-12 has a beam running and cannot be deactivated',
    );
    expect((await dbError(saveLoom(sup76, { machine_no: 'X', factory_id: id['L-76'], active: true }, l.id))).db.code).toBe('42501');
  });

  it('variance threshold changes the flags', async () => {
    await setVarianceThreshold(owner, 60);
    expect((await getBeamSummary(owner, id['B-001']))!.warp_variance_flag).toBe(false);
    expect((await dbError(setVarianceThreshold(sup76, 1))).db.code).toBe('42501');
  });
});

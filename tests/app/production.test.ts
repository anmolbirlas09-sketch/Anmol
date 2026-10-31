// Metre-first production through the app's data layer (supabase-js → gateway →
// Postgres with RLS): entry, rolls, idempotency, dashboard, reports and filters.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBeamSummary } from '@/lib/data/beams';
import type { Db } from '@/lib/data/client';
import { loadDashboard } from '@/lib/data/dashboard';
import { createDispatch } from '@/lib/data/dispatch';
import { greyStock } from '@/lib/data/grey';
import { listRolls, listTakeoffs, loadBeam, recordProduction } from '@/lib/data/looms';
import { DataError, friendlyError } from '@/lib/errors';
import { todayIST } from '@/lib/format';
import { buildReport } from '@/lib/reports/build';
import type { ProductionInputForm } from '@/lib/validation';
import { freshDb, type TestDb } from '../db/db';
import { startFakeSupabase, type FakeSupabase } from '../stack/fake-supabase';

let db: TestDb;
let gw: FakeSupabase;
let owner: Db, entry76: Db;
const id: Record<string, string> = {};
const today = todayIST();

async function signIn(email: string): Promise<Db> {
  const c = createClient(gw.url, gw.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  return c;
}

const entry = (loom: string, over: Partial<ProductionInputForm> = {}): ProductionInputForm => ({
  loom_id: id[loom], fabric_quality_id: id['Mono White'], meters: 680, wasted_meters: 33, roll_length_m: 100,
  entry_date: today, finish_beam: false, ...over,
});

beforeAll(async () => {
  db = await freshDb();
  gw = await startFakeSupabase({ databaseUrl: db.url });
  await db.createUser({ email: 'owner@test.local', role: 'owner' });
  await db.createUser({ email: 'entry76@test.local', role: 'data_entry', factoryCode: 'L-76' });
  [owner, entry76] = await Promise.all([signIn('owner@test.local'), signIn('entry76@test.local')]);
  id['Mono White'] = await db.id('fabric_qualities', 'name', 'Mono White');
  id['White/Black'] = await db.id('fabric_qualities', 'name', 'White/Black');
  const f76 = await db.id('factories', 'code', 'L-76');
  for (const [beam, loom] of [['M-001', 'L76-05'], ['M-002', 'L76-06']]) {
    id[beam] = (await db.sql.query(
      `insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ($1, $2, $3, 3000) returning id`, [beam, id['Mono White'], f76],
    )).rows[0].id;
    id[loom] = await db.id('looms', 'machine_no', loom);
    await loadBeam(owner, id[beam], id[loom]);
  }
});

afterAll(async () => {
  await gw?.close();
  await db?.close();
});

describe('production entry (data entry user, metre-only)', () => {
  it('records 680 m / 33 m wasted → 647 m usable in 7 rolls, no weights', async () => {
    const r = await recordProduction(entry76, entry('L76-05', { shift: 'day', client_ref: randomUUID() }));
    expect([r.meters, r.wasted_meters, r.net_meters, r.wastage_pct, r.roll_count]).toEqual([680, 33, 647, 4.85, 7]);
    expect([r.kgs, r.estimated_kg, r.total_yarn_kg, r.waste_kg]).toEqual([null, null, null, null]);
    expect(r.created_by_name).toBe('entry76');
    const rolls = await listRolls(entry76, { productionId: r.id });
    expect(rolls.map((x) => x.meters).reduce((a, b) => a + b, 0)).toBe(647);
    expect(rolls[0].roll_no).toMatch(/^L76-05-\d{6}-01$/);
  });

  it('a repeated submission (double tap) does not create a second entry', async () => {
    const ref = randomUUID();
    const a = await recordProduction(entry76, entry('L76-06', { meters: 100, wasted_meters: 0, client_ref: ref }));
    const b = await recordProduction(entry76, entry('L76-06', { meters: 100, wasted_meters: 0, client_ref: ref }));
    expect(b.id).toBe(a.id);
    expect((await listTakeoffs(owner, { loomId: id['L76-06'] })).length).toBe(1);
  });

  it('with weights: estimated vs actual kept apart; KG wastage from measured kg', async () => {
    const r = await recordProduction(entry76, entry('L76-06', {
      meters: 250, wasted_meters: 10, roll_length_m: 50, gsm: 65, width_m: 1.5, weighed_kg: 24, warp_kg: 15, weft_kg: 12, waste_kg: 1.35,
    }));
    expect([r.estimated_kg, r.kgs, r.total_yarn_kg, r.waste_kg, r.weight_wastage_pct, r.waste_kg_estimated]).toEqual([24.375, 24, 27, 1.35, 5, null]);
  });

  it('wrong fabric quality for the loom is refused with a clear message', async () => {
    let err: unknown;
    try {
      await recordProduction(entry76, entry('L76-05', { fabric_quality_id: id['White/Black'] }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DataError);
    expect(friendlyError(err)).toBe('Beam M-001 is weaving Mono White, not the fabric quality selected');
  });
});

describe('beam, stock and dashboard', () => {
  it('beam totals in metres and KG (NULL-aware)', async () => {
    const b = (await getBeamSummary(owner, id['M-002']))!;
    expect([b.grey_meters, b.wasted_meters, b.net_meters, b.wastage_pct]).toEqual([350, 10, 340, 2.86]);
    expect([b.estimated_kg, b.grey_kg, b.prod_total_yarn_kg, b.waste_kg_actual, b.weight_wastage_pct_actual]).toEqual([24.375, 24, 27, 1.35, 5]);
    const m1 = (await getBeamSummary(owner, id['M-001']))!;
    expect([m1.grey_kg, m1.estimated_kg, m1.waste_kg_actual]).toEqual([null, null, null]);
  });

  it('grey stock is the usable metres; kg counts weighed fabric only', async () => {
    const mw = (await greyStock(owner)).find((r) => r.fabric_quality_name === 'Mono White')!;
    expect([mw.stock_m, mw.stock_kg, mw.unweighed_count]).toEqual([647 + 100 + 240, 24, 2]);
    // metre-only dispatch
    await createDispatch(entry76, { fabric_quality_id: id['Mono White'], factory_id: mw.factory_id, entry_date: today, meters: 87 });
    expect((await greyStock(owner)).find((r) => r.fabric_quality_name === 'Mono White')!.stock_m).toBe(900);
  });

  it("dashboard: today's total, wasted, net and wastage %; weights only where recorded", async () => {
    const d = await loadDashboard(owner, { today });
    expect([d.todayM, d.todayWastedM, d.todayNetM, d.todayWastagePct, d.todayTakeoffs]).toEqual([1030, 43, 987, 4.17, 3]);
    expect([d.todayKg, d.todayEstimatedKg]).toEqual([24, 24.375]);
  });
});

describe('reports with filters', () => {
  const p = () => ({ from: today.slice(0, 8) + '01', to: today, period: 'day' as const });

  it('production register: one row per entry with metres first and KG where recorded', async () => {
    const r = await buildReport(owner, 'production', p());
    expect(r.rows.map((x) => [x.machine_no, x.meters, x.wasted_meters, x.net_meters, x.wastage_pct, x.roll_count, x.kgs])).toEqual([
      ['L76-05', 680, 33, 647, 4.85, 7, null],
      ['L76-06', 100, 0, 100, 0, 1, null],
      ['L76-06', 250, 10, 240, 4, 5, 24],
    ]);
    expect(r.totals).toMatchObject({ meters: 1030, wasted_meters: 43, net_meters: 987, wastage_pct: 4.17, roll_count: 13, kgs: 24, waste_kg: 1.35 });
  });

  it('filters by loom, fabric quality and beam number', async () => {
    expect((await buildReport(owner, 'production', { ...p(), loomId: id['L76-05'], loomNo: 'L76-05' })).rows.length).toBe(1);
    expect((await buildReport(owner, 'production', { ...p(), beamNo: 'm-002' })).rows.length).toBe(2);
    expect((await buildReport(owner, 'production', { ...p(), fabricQualityId: id['White/Black'] })).rows.length).toBe(0);
    const rolls = await buildReport(owner, 'rolls', { ...p(), beamNo: 'M-001' });
    expect(rolls.rows.length).toBe(7);
    expect(rolls.totals).toMatchObject({ meters: 647 });
  });

  it('loom-wise production: metres, wastage % (weighted) and KG, with filters', async () => {
    const r = await buildReport(owner, 'loom-production', { ...p(), loomId: id['L76-06'] });
    expect(r.rows.map((x) => [x.machine_no, x.takeoff_count, x.meters, x.wasted_meters, x.net_meters, x.wastage_pct, x.kgs, x.estimated_kg])).toEqual([
      ['L76-06', 2, 350, 10, 340, 2.86, 24, 24.375],
    ]);
  });
});

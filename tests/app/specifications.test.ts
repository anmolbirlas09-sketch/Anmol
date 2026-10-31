// Parent qualities and specifications through the app's data layer (RLS on).
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBeam } from '@/lib/data/beams';
import type { Db } from '@/lib/data/client';
import { createDispatch } from '@/lib/data/dispatch';
import { greyStock, groupGreyByQuality } from '@/lib/data/grey';
import { loadBeam, recordProduction } from '@/lib/data/looms';
import { listSpecifications, saveMaster, saveSpecification } from '@/lib/data/masters';
import { DataError, friendlyError } from '@/lib/errors';
import { todayIST } from '@/lib/format';
import { buildReport } from '@/lib/reports/build';
import { freshDb, type TestDb } from '../db/db';
import { startFakeSupabase, type FakeSupabase } from '../stack/fake-supabase';

let db: TestDb;
let gw: FakeSupabase;
let owner: Db, sup76: Db, entry76: Db;
const id: Record<string, string> = {};
const today = todayIST();

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

beforeAll(async () => {
  db = await freshDb();
  gw = await startFakeSupabase({ databaseUrl: db.url });
  await db.createUser({ email: 'owner@test.local', role: 'owner' });
  await db.createUser({ email: 'sup76@test.local', role: 'supervisor', factoryCode: 'L-76' });
  await db.createUser({ email: 'entry76@test.local', role: 'data_entry', factoryCode: 'L-76' });
  [owner, sup76, entry76] = await Promise.all(['owner', 'sup76', 'entry76'].map((u) => signIn(`${u}@test.local`)));
  for (const [name, den] of [['PP 0.17', 210], ['PT 0.125', 150]] as const) {
    id[name] = (await db.sql.query(`insert into yarn_qualities (name, denier) values ($1, $2) returning id`, [name, den])).rows[0].id;
  }
  id['L-76'] = await db.id('factories', 'code', 'L-76');
});
afterAll(async () => {
  await gw?.close();
  await db?.close();
});

describe('managing specifications', () => {
  it('a supervisor creates Quality 101 and three specifications; IDs are generated', async () => {
    id.q = await saveMaster(sup76, 'fabric_qualities', { name: 'Quality 101', warp_crimp_pct: 0, weft_wastage_pct: 0, active: true });
    const add = (reed: number, epi: number, warp: string, weft: string) =>
      saveSpecification(sup76, { fabric_quality_id: id.q, reed, ends_per_inch: epi, warp_yarn_quality_id: id[warp], weft_yarn_quality_id: id[weft], active: true });
    id.S1 = await add(48, 52, 'PP 0.17', 'PP 0.17');
    id.S2 = await add(52, 56, 'PT 0.125', 'PP 0.17');
    id.S3 = await add(56, 60, 'PT 0.125', 'PT 0.125');
    const specs = await listSpecifications(entry76, { qualityId: id.q });
    expect(specs.map((s) => [s.spec_code, s.reed, s.ends_per_inch, s.weft_yarn_quality_name, s.warp_yarn_quality_name])).toEqual([
      ['QUALITY101-S1', 48, 52, 'PP 0.17', 'PP 0.17'],
      ['QUALITY101-S2', 52, 56, 'PP 0.17', 'PT 0.125'],
      ['QUALITY101-S3', 56, 60, 'PT 0.125', 'PT 0.125'],
    ]);
  });

  it('data entry staff can view but not create specifications', async () => {
    const e = await dbError(saveSpecification(entry76, { fabric_quality_id: id.q, reed: 40, ends_per_inch: 44, warp_yarn_quality_id: id['PP 0.17'], weft_yarn_quality_id: id['PP 0.17'], active: true }));
    expect(e.db.code).toBe('42501');
  });

  it('a duplicate combination gets a clear message', async () => {
    const e = await dbError(saveSpecification(owner, { fabric_quality_id: id.q, reed: 48, ends_per_inch: 52, warp_yarn_quality_id: id['PP 0.17'], weft_yarn_quality_id: id['PP 0.17'], active: true }));
    expect(friendlyError(e)).toBe('This specification (same reed, ends per inch and yarns) already exists');
  });

  it('search by parent name or Specification ID', async () => {
    expect((await listSpecifications(owner, { q: 'quality101-s2' })).map((s) => s.spec_code)).toEqual(['QUALITY101-S2']);
    expect((await listSpecifications(owner, { q: 'Quality 101' })).length).toBe(3);
  });
});

describe('production, stock and reports per specification', () => {
  it('beams on two looms with different specifications; production goes to each one', async () => {
    for (const [beam, spec, loom] of [['Q1-B1', 'S1', 'L76-10'], ['Q1-B2', 'S3', 'L76-11']] as const) {
      const b = await createBeam(entry76, { beam_no: beam, fabric_quality_id: id.q, fabric_specification_id: id[spec], factory_id: id['L-76'], warp_length_m: 2000, created_date: today });
      id[loom] = await db.id('looms', 'machine_no', loom);
      await loadBeam(entry76, b.id, id[loom]);
    }
    const a = await recordProduction(entry76, { loom_id: id['L76-10'], fabric_quality_id: id.q, fabric_specification_id: id.S1, meters: 680, wasted_meters: 33, roll_length_m: 100, entry_date: today, finish_beam: false });
    const b = await recordProduction(entry76, { loom_id: id['L76-11'], fabric_quality_id: id.q, fabric_specification_id: id.S3, meters: 300, wasted_meters: 0, roll_length_m: 100, entry_date: today, finish_beam: false });
    expect([a.spec_code, a.reed, a.ends_per_inch, a.warp_yarn_quality_name, a.weft_yarn_quality_name]).toEqual(['QUALITY101-S1', 48, 52, 'PP 0.17', 'PP 0.17']);
    expect([b.spec_code, b.net_meters, b.roll_count]).toEqual(['QUALITY101-S3', 300, 3]);
  });

  it('grey stock: one parent, separate specification balances; dispatch from one spec only', async () => {
    await createDispatch(entry76, { fabric_quality_id: id.q, fabric_specification_id: id.S3, factory_id: id['L-76'], entry_date: today, meters: 100 });
    const g = groupGreyByQuality(await greyStock(owner)).find((x) => x.fabric_quality_name === 'Quality 101')!;
    expect(g.stock_m).toBe(847);
    expect(g.specs.map((s) => [s.spec_code, s.stock_m])).toEqual([['QUALITY101-S1', 647], ['QUALITY101-S3', 200]]);
  });

  it('specification report: parent row with totals, specification rows under it, or parents only', async () => {
    const p = { from: today.slice(0, 8) + '01', to: today, period: 'day' as const, fabricQualityId: id.q };
    const r = await buildReport(owner, 'specifications', p);
    const levels = r.rows.map((x) => [x.level, x.spec_code, x.meters, x.net_meters, x.stock_m]);
    expect(levels).toEqual([
      ['Parent quality', '3 specifications', 980, 947, 847],
      ['Specification', 'QUALITY101-S1', 680, 647, 647],
      ['Specification', 'QUALITY101-S2', null, null, null],
      ['Specification', 'QUALITY101-S3', 300, 300, 200],
    ]);
    expect(r.rows[0].wastage_pct).toBe(3.37); // 33 / 980
    expect(r.indented).toEqual([false, true, true, true]);
    expect(r.totals).toMatchObject({ meters: 980, stock_m: 847 }); // parents only: not counted twice

    const parents = await buildReport(owner, 'specifications', { ...p, showSpecs: false });
    expect(parents.rows.length).toBe(1);
  });

  it('production register shows reed, ends per inch and yarns; filters by specification', async () => {
    const p = { from: today.slice(0, 8) + '01', to: today, period: 'day' as const };
    const r = await buildReport(owner, 'production', { ...p, fabricSpecificationId: id.S1 });
    expect(r.rows.map((x) => [x.machine_no, x.spec_code, x.reed, x.ends_per_inch, x.weft_yarn, x.warp_yarn, x.meters, x.wasted_meters])).toEqual([
      ['L76-10', 'QUALITY101-S1', 48, 52, 'PP 0.17', 'PP 0.17', 680, 33],
    ]);
  });
});

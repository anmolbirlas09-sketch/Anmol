// Phase 3 data layer: loading, take-off, finishing, grey stock — §8 steps 5–9
// through supabase-js and RLS, as the app does it.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBeamSummary } from '@/lib/data/beams';
import type { Db } from '@/lib/data/client';
import { greyStock, groupGreyByQuality } from '@/lib/data/grey';
import { deleteTakeoff, finishBeam, getLoomStatus, listLoomStatus, listPreparedBeams, listTakeoffs, loadBeam, recordTakeoff, unloadBeam } from '@/lib/data/looms';
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

async function dbError(p: Promise<unknown>): Promise<DataError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return e as DataError;
  }
  throw new Error('expected an error');
}

const takeoff = (loom: string, meters: number, kgs: number, extra: Partial<Parameters<typeof recordTakeoff>[1]> = {}) => ({
  loom_id: id[loom], meters, kgs, entry_date: '2026-10-25', finish_beam: false, ...extra,
});

beforeAll(async () => {
  db = await freshDb();
  gw = await startFakeSupabase({ databaseUrl: db.url });
  await db.createUser({ email: 'owner@test.local', role: 'owner', name: 'Owner' });
  await db.createUser({ email: 'sup76@test.local', role: 'supervisor', factoryCode: 'L-76' });
  await db.createUser({ email: 'entry76@test.local', role: 'data_entry', factoryCode: 'L-76', name: 'Ramesh' });
  [owner, sup76, entry76] = await Promise.all(['owner', 'sup76', 'entry76'].map((u) => signIn(`${u}@test.local`)));

  // §8 steps 1–3 set up directly in the database.
  const s = db.sql;
  const one = async (q: string, p: unknown[] = []) => (await s.query(q, p)).rows[0].id as string;
  const f76 = await db.id('factories', 'code', 'L-76');
  const f75 = await db.id('factories', 'code', 'L-75');
  const white = await db.id('yarn_qualities', 'name', 'Mono 0.25 White');
  const black = await db.id('yarn_qualities', 'name', 'Mono 0.25 Black');
  const a = await one(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('A-101', $1, $2, 1000) returning id`, [white, f76]);
  const b = await one(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('B-202', $1, $2, 500) returning id`, [black, f75]);
  id['B-001'] = await one(`insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('B-001', (select id from fabric_qualities where name = 'Mono White'), $1, 3000) returning id`, [f76]);
  id['B-002'] = await one(`insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('B-002', (select id from fabric_qualities where name = 'White/Black'), $1, 2000) returning id`, [f75]);
  await s.query(
    `insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $3, 'warp', 400), ($1, $3, 'weft', 300), ($2, $3, 'warp', 250), ($2, $4, 'weft', 200)`,
    [id['B-001'], id['B-002'], a, b],
  );
  for (const m of ['L76-05', 'L75-12', 'L76-06']) id[m] = await db.id('looms', 'machine_no', m);
});

afterAll(async () => {
  await gw?.close();
  await db?.close();
});

describe('§8 steps 5–9 through the app’s data layer', () => {
  it('5. loads B-001 on L76-05, blocks B-002 on the same loom, loads B-002 on L75-12 → 2 running, 66 idle', async () => {
    expect((await listPreparedBeams(entry76)).map((b) => b.beam_no)).toEqual(['B-001']); // L-76 staff see their beam only
    await loadBeam(entry76, id['B-001'], id['L76-05']);

    const err = await dbError(loadBeam(owner, id['B-002'], id['L76-05']));
    expect(err.db.code).toBe('WV002');
    expect(friendlyError(err)).toBe('Loom L76-05 already has beam B-001 running. Finish or unload it first.');

    await loadBeam(owner, id['B-002'], id['L75-12']);
    const looms = await listLoomStatus(owner);
    expect(looms.length).toBe(68);
    expect(looms.filter((l) => l.status === 'running').length).toBe(2);
    expect(looms.filter((l) => l.status === 'idle').length).toBe(66);
    expect(looms[0].machine_no).toBe('L76-01'); // L-76 first, in machine order

    const l = (await getLoomStatus(entry76, id['L76-05']))!;
    expect([l.status, l.beam_no, l.fabric_quality_name, l.warp_kg, l.weft_kg, l.expected_fabric_length_m, l.total_yarn_kg])
      .toEqual(['running', 'B-001', 'Mono White', 400, 300, 2912.62, 700]);
  });

  it('L-76 data entry cannot load onto an L-75 loom', async () => {
    const f76 = await db.id('factories', 'code', 'L-76');
    const fq = await db.id('fabric_qualities', 'name', 'Mono White');
    const bid = (await db.sql.query(`insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('B-076', $1, $2, 100) returning id`, [fq, f76])).rows[0].id;
    const free75 = await db.id('looms', 'machine_no', 'L75-01');
    const err = await dbError(loadBeam(entry76, bid, free75));
    expect(err.db.code).toBe('WV005');
    expect(friendlyError(err)).toBe('You do not have access to this factory');
  });

  it('6. take-offs 1,200 m / 650 kg and 800 m / 420 kg → grey 2,000 m / 1,070 kg by quality and factory', async () => {
    const row = await recordTakeoff(entry76, takeoff('L76-05', 1200, 650, { shift: 'day', roll_no: 'R-1' }));
    expect(row.beam_id).toBe(id['B-001']);
    await recordTakeoff(owner, takeoff('L75-12', 800, 420));

    const rows = await greyStock(owner);
    expect(rows.map((r) => [r.fabric_quality_name, r.factory_code, r.stock_m, r.stock_kg])).toEqual([
      ['Mono White', 'L-76', 1200, 650],
      ['White/Black', 'L-75', 800, 420],
    ]);
    const groups = groupGreyByQuality(rows);
    expect(groups.reduce((s, g) => s + g.stock_m, 0)).toBe(2000);
    expect(groups.reduce((s, g) => s + g.stock_kg, 0)).toBe(1070);
    expect((await greyStock(owner, { factoryId: await db.id('factories', 'code', 'L-75') })).map((r) => r.stock_m)).toEqual([800]);

    const t = await listTakeoffs(entry76, { loomId: id['L76-05'] });
    expect(t.map((x) => [x.machine_no, x.beam_no, x.meters, x.kgs, x.shift, x.roll_no, x.created_by_name, x.meters_per_kg]))
      .toEqual([['L76-05', 'B-001', 1200, 650, 'day', 'R-1', 'Ramesh', 1.846]]);
    expect((await getLoomStatus(entry76, id['L76-05']))!.meters_on_beam).toBe(1200);
  });

  it('L-76 staff only see L-76 grey stock and take-offs', async () => {
    expect((await greyStock(entry76)).map((r) => r.factory_code)).toEqual(['L-76']);
    expect((await listTakeoffs(entry76)).map((t) => t.machine_no)).toEqual(['L76-05']);
  });

  it('7. B-001: metres, weights and m/kg; yarn − fabric weight is not reported as wastage', async () => {
    const b = (await getBeamSummary(entry76, id['B-001']))!;
    expect([b.total_yarn_kg, b.grey_kg, b.grey_meters, b.wasted_meters, b.net_meters, b.wastage_pct, b.meters_per_kg]).toEqual([700, 650, 1200, 0, 1200, 0, 1.846]);
    expect([b.waste_kg_actual, b.waste_kg_estimated, b.estimated_kg]).toEqual([null, null, null]);
  });

  it('a take-off from an idle loom is refused with a clear message', async () => {
    const err = await dbError(recordTakeoff(entry76, takeoff('L76-06', 10, 5)));
    expect(friendlyError(err)).toBe('Loom L76-06 has no beam running');
  });

  it('data entry cannot unload a beam or delete take-offs; a supervisor can', async () => {
    expect(friendlyError(await dbError(unloadBeam(entry76, id['B-001'])))).toBe('Only an owner or supervisor can unload a beam');
    const extra = await recordTakeoff(sup76, takeoff('L76-05', 10, 5));
    expect(await deleteTakeoff(entry76, extra.id)).toBe(false);
    expect(await deleteTakeoff(sup76, extra.id)).toBe(true);
  });

  it('9. finishing B-001 frees L76-05', async () => {
    await finishBeam(entry76, id['B-001']);
    const l = (await getLoomStatus(owner, id['L76-05']))!;
    expect([l.status, l.beam_no]).toEqual(['idle', null]);
    expect((await listLoomStatus(owner)).filter((x) => x.status === 'running').length).toBe(1);
    expect((await getBeamSummary(owner, id['B-001']))!.status).toBe('finished');
  });

  it('record_takeoff with finish_beam=true saves and finishes in one step', async () => {
    await recordTakeoff(owner, takeoff('L75-12', 5, 2, { finish_beam: true }));
    const b = (await getBeamSummary(owner, id['B-002']))!;
    expect([b.status, b.grey_meters]).toEqual(['finished', 805]);
    expect((await getLoomStatus(owner, id['L75-12']))!.status).toBe('idle');
  });

  it('unloading a beam puts it back off the loom (supervisor)', async () => {
    const f76 = await db.id('factories', 'code', 'L-76');
    const fq = await db.id('fabric_qualities', 'name', 'Mono White');
    const bid = (await db.sql.query(`insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('B-003', $1, $2, 100) returning id`, [fq, f76])).rows[0].id;
    await loadBeam(entry76, bid, id['L76-06']);
    expect(friendlyError(await dbError(unloadBeam(entry76, bid)))).toBe('Only an owner or supervisor can unload a beam'); // data entry cannot
    expect(await unloadBeam(sup76, bid)).toBe(true);
    expect((await getLoomStatus(owner, id['L76-06']))!.status).toBe('idle');
    expect((await getBeamSummary(owner, bid))!.status).toBe('prepared');
  });
});

// Beam cards, beam replacement, time-stamped production and the daily / shift /
// production reports — through the app's data layer (supabase-js → gateway → Postgres, RLS on).
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBeam, getBeamSummary, listBeamEvents, listBeams, updateBeam } from '@/lib/data/beams';
import type { Db } from '@/lib/data/client';
import { greyStock, groupGreyByQuality } from '@/lib/data/grey';
import { getLoomStatus, listTakeoffs, loadBeam, recordProduction } from '@/lib/data/looms';
import { DataError, friendlyError } from '@/lib/errors';
import { buildReport } from '@/lib/reports/build';
import { freshDb, type TestDb } from '../db/db';
import { startFakeSupabase, type FakeSupabase } from '../stack/fake-supabase';

let db: TestDb;
let gw: FakeSupabase;
let owner: Db, sup76: Db, entry76: Db;
const id: Record<string, string> = {};
const DAY = '2026-10-31';

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
const reading = (loom: string, a: { time?: string; counter?: number; meters?: number; shift?: 'day' | 'night'; roll?: number }) =>
  recordProduction(entry76, {
    loom_id: id[loom], entry_date: DAY, production_time: a.time, counter_reading: a.counter, meters: a.meters, shift: a.shift,
    roll_length_m: a.roll, finish_beam: false,
  });

beforeAll(async () => {
  db = await freshDb();
  gw = await startFakeSupabase({ databaseUrl: db.url });
  await db.createUser({ email: 'owner@test.local', role: 'owner' });
  await db.createUser({ email: 'sup76@test.local', role: 'supervisor', factoryCode: 'L-76' });
  await db.createUser({ email: 'entry76@test.local', role: 'data_entry', factoryCode: 'L-76' });
  [owner, sup76, entry76] = await Promise.all(['owner', 'sup76', 'entry76'].map((u) => signIn(`${u}@test.local`)));
  id['L-76'] = await db.id('factories', 'code', 'L-76');
  id['Mono White'] = await db.id('fabric_qualities', 'name', 'Mono White');
  for (const l of ['L76-01', 'L76-02', 'L76-36']) id[l] = await db.id('looms', 'machine_no', l);
});
afterAll(async () => {
  await gw?.close();
  await db?.close();
});

describe('beam cards', () => {
  it('data entry saves a beam card with nothing but the shed; it is CARD-n and can be found by that', async () => {
    const b = await createBeam(entry76, { factory_id: id['L-76'] });
    expect(b.beam_no).toMatch(/^CARD-\d+$/);
    id.blank = b.id;
    const found = await listBeams(entry76, { q: b.beam_no.toLowerCase() });
    expect(found.map((x) => x.beam_id)).toEqual([b.id]);
  });

  it('the owner may save a card that is at no shed yet; factory-scoped staff do not see it', async () => {
    const b = await createBeam(owner, { beam_no: 'NOSHED-1' });
    expect((await getBeamSummary(owner, b.id))!.factory_code).toBeNull();
    expect(await getBeamSummary(entry76, b.id)).toBeNull();
  });

  it('a supervisor completes missing information later; data entry cannot edit a saved card', async () => {
    expect(await updateBeam(entry76, id.blank, { beam_no: 'X' })).toBe(false);
    expect(await updateBeam(sup76, id.blank, { beam_no: 'BC-11', fabric_quality_id: id['Mono White'], total_ends: 4200, gross_weight_kg: 260, weave: 'Plain' })).toBe(true);
    const b = (await getBeamSummary(owner, id.blank))!;
    expect([b.beam_no, b.fabric_quality_name, b.spec_code, b.total_ends, b.gross_weight_kg, b.weave, b.getting_date]).toEqual(
      ['BC-11', 'Mono White', 'MONOWHITE-S1', 4200, 260, 'Plain', null]);
  });

  it('search and filter by beam number, quality and loom', async () => {
    await loadBeam(entry76, id.blank, id['L76-01']);
    expect((await listBeams(owner, { q: 'bc-11' })).map((b) => b.beam_no)).toEqual(['BC-11']);
    expect((await listBeams(owner, { loomId: id['L76-01'] })).map((b) => b.beam_no)).toEqual(['BC-11']);
    expect((await listBeams(owner, { q: 'L76-01' })).map((b) => b.beam_no)).toEqual(['BC-11']);
    expect((await listBeams(owner, { qualityId: id['Mono White'] })).map((b) => b.beam_no)).toContain('BC-11');
  });
});

describe('production with actual time and counter readings', () => {
  it('5:10 PM 1,085 (85 m typed) → 7:25 PM 1,172 → 9:40 PM 1,260: 87 m and 88 m from the counter', async () => {
    const a = await reading('L76-01', { time: '17:10', counter: 1085, meters: 85, roll: 50 });
    const b = await reading('L76-01', { time: '19:25', counter: 1172, roll: 50 });
    const c = await reading('L76-01', { time: '21:40', counter: 1260 });
    expect([a, b, c].map((x) => [x.production_time, x.shift, x.meters, x.meters_source, x.beam_no, x.spec_code])).toEqual([
      ['17:10:00', 'day', 85, 'manual', 'BC-11', 'MONOWHITE-S1'],
      ['19:25:00', 'day', 87, 'counter', 'BC-11', 'MONOWHITE-S1'],
      ['21:40:00', 'night', 88, 'counter', 'BC-11', 'MONOWHITE-S1'],
    ]);
    expect([b.roll_count, c.roll_count]).toEqual([2, 0]); // rolls only when a roll length is given
  });

  it('without a time the entry still saves; time-ordered history lists newest reading first', async () => {
    const d = await reading('L76-01', { meters: 12 });
    expect([d.production_time, d.meters]).toEqual([null, 12]);
    const hist = await listTakeoffs(owner, { loomId: id['L76-01'] });
    expect(hist.filter((t) => t.counter_reading !== null).map((t) => t.counter_reading)).toEqual([1260, 1172, 1085]);
  });

  it('a counter reading with no earlier reading on that loom does not invent metres', async () => {
    const b = await createBeam(entry76, { beam_no: 'BC-12', factory_id: id['L-76'] });
    await loadBeam(entry76, b.id, id['L76-02']);
    const r = await reading('L76-02', { time: '09:00', counter: 400 });
    expect([r.meters, r.meters_source, r.previous_reading]).toEqual([null, null, null]);
    expect((await getLoomStatus(owner, id['L76-02']))!.last_counter_reading).toBe(400);
    // the beam has no quality: production is kept and shown as "quality not set" in stock
    const r2 = await reading('L76-02', { time: '11:00', counter: 450 });
    expect([r2.meters, r2.fabric_quality_name]).toEqual([50, null]);
    const unset = groupGreyByQuality(await greyStock(owner)).find((g) => g.fabric_quality_id === null)!;
    expect(unset.stock_m).toBe(50);
  });

  it('a lower counter reading is explained, not saved as negative production', async () => {
    const e = await dbError(reading('L76-02', { time: '12:00', counter: 10 }));
    expect(friendlyError(e)).toMatch(/^Counter reading 10 is lower than the previous reading 450 /);
  });
});

describe('replacing a beam keeps its history', () => {
  it('data entry may replace by finishing the running beam, not by unloading it', async () => {
    const nb = await createBeam(entry76, { beam_no: 'BC-13', factory_id: id['L-76'], fabric_quality_id: id['Mono White'] });
    expect(friendlyError(await dbError(loadBeam(entry76, nb.id, id['L76-01'], 'unload')))).toBe('Only an owner or supervisor can unload a beam');
    await loadBeam(entry76, nb.id, id['L76-01'], 'finish');
    const old = (await getBeamSummary(owner, id.blank))!;
    expect([old.status, old.grey_meters, old.actual_finish_date !== null]).toEqual(['finished', 85 + 87 + 88 + 12, true]);
    expect((await getLoomStatus(owner, id['L76-01']))!.beam_no).toBe('BC-13');
    const events = await listBeamEvents(owner, { loomId: id['L76-01'] });
    expect(events.map((e) => `${e.event} ${e.beam_no}`)).toEqual(['loaded BC-13', 'finished BC-11', 'loaded BC-11']);
  });

  it('a supervisor replaces by unloading; the unloaded beam can go to another loom', async () => {
    const nb = await createBeam(sup76, { beam_no: 'BC-14', factory_id: id['L-76'] });
    await loadBeam(sup76, nb.id, id['L76-02'], 'unload');
    const off = (await getBeamSummary(owner, (await listBeams(owner, { q: 'BC-12' }))[0].beam_id))!;
    expect([off.status, off.grey_meters, off.loom_id]).toEqual(['prepared', 50, null]);
    await loadBeam(sup76, off.beam_id, id['L76-36']);
    expect((await listBeamEvents(owner, { beamId: off.beam_id })).map((e) => `${e.event} ${e.machine_no}`)).toEqual(
      ['loaded L76-02', 'unloaded L76-02', 'loaded L76-36']);
    // its earlier production still says which loom wove it
    expect((await listTakeoffs(owner, { beamId: off.beam_id })).map((t) => t.machine_no)).toEqual(['L76-02', 'L76-02']);
  });
});

describe('reports', () => {
  const p = { from: DAY, to: DAY, period: 'day' as const };

  it('production register: date, actual time, counter, previous reading and where the metres came from', async () => {
    const r = await buildReport(owner, 'production', { ...p, loomId: id['L76-01'] });
    // (the entry without a time sits at the moment it was typed in, so its place depends on the clock)
    expect(r.rows.filter((x) => x.production_time !== null).map((x) => [x.production_time, x.counter_reading, x.previous_reading, x.meters_source, x.meters])).toEqual([
      ['5:10 PM', 1085, null, 'typed', 85],
      ['7:25 PM', 1172, 1085, 'counter', 87],
      ['9:40 PM', 1260, 1172, 'counter', 88],
    ]);
    expect(r.rows.filter((x) => x.production_time === null).map((x) => [x.counter_reading, x.meters_source, x.meters])).toEqual([[null, 'typed', 12]]);
    const evening = await buildReport(owner, 'production', { ...p, timeFrom: '17:00', timeTo: '20:00' });
    expect(evening.rows.map((x) => x.meters)).toEqual([85, 87]);
  });

  it('daily report for one day lists all looms (68), with zero rows; grouped by quality or beam too', async () => {
    const r = await buildReport(owner, 'daily', p);
    expect(r.rows.length).toBe(68);
    const l1 = r.rows.find((x) => x.label === 'L76-01')!;
    expect([l1.takeoff_count, l1.meters]).toEqual([4, 272]);
    expect(r.rows.find((x) => x.label === 'L75-01')).toMatchObject({ takeoff_count: 0, meters: null });
    expect(r.totals).toMatchObject({ takeoff_count: 6, meters: 322 });
    const q = await buildReport(owner, 'daily', { ...p, group: 'quality' });
    expect(q.rows.map((x) => [x.label, x.meters])).toEqual([['Mono White', 272], ['Not set', 50]]);
    const b = await buildReport(owner, 'daily', { ...p, group: 'beam' });
    expect(b.rows.map((x) => x.label)).toEqual(['BC-11 · Mono White', 'BC-12 · Not set']);
  });

  it('shift report: day and night production per loom, with totals per shift', async () => {
    const r = await buildReport(owner, 'shift', p);
    const l1 = r.rows.find((x) => x.machine_no === 'L76-01')!;
    expect([l1.day_m, l1.night_m, l1.noshift_m, l1.meters, l1.day_entries, l1.night_entries]).toEqual([172, 88, 12, 272, 2, 1]);
    expect(r.totals).toMatchObject({ day_m: 222, night_m: 88, noshift_m: 12, meters: 322 });
    const nights = await buildReport(owner, 'loom-production', { ...p, shift: 'night' });
    expect(nights.rows.map((x) => [x.machine_no, x.meters])).toEqual([['L76-01', 88]]);
  });
});

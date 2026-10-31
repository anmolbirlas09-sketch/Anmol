// Phase 4: dashboard numbers (all factories and per factory) and the realtime
// change feed the dashboard listens to.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/data/client';
import { loadDashboard, productionOn } from '@/lib/data/dashboard';
import { loadBeam, recordTakeoff } from '@/lib/data/looms';
import { todayIST } from '@/lib/format';
import { freshDb, type TestDb } from '../db/db';
import { startFakeSupabase, type FakeSupabase } from '../stack/fake-supabase';

let db: TestDb;
let gw: FakeSupabase;
let owner: Db, entry76: Db;
const id: Record<string, string> = {};
const today = todayIST();
const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

async function signIn(email: string): Promise<Db> {
  const c = createClient(gw.url, gw.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  return c;
}

beforeAll(async () => {
  db = await freshDb();
  gw = await startFakeSupabase({ databaseUrl: db.url });
  await db.createUser({ email: 'owner@test.local', role: 'owner' });
  await db.createUser({ email: 'entry76@test.local', role: 'data_entry', factoryCode: 'L-76' });
  [owner, entry76] = await Promise.all([signIn('owner@test.local'), signIn('entry76@test.local')]);

  // §8 steps 1–6
  const s = db.sql;
  const one = async (q: string, p: unknown[] = []) => (await s.query(q, p)).rows[0].id as string;
  id['L-76'] = await db.id('factories', 'code', 'L-76');
  id['L-75'] = await db.id('factories', 'code', 'L-75');
  const white = await db.id('yarn_qualities', 'name', 'Mono 0.25 White');
  const black = await db.id('yarn_qualities', 'name', 'Mono 0.25 Black');
  const a = await one(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('A-101', $1, $2, 1000) returning id`, [white, id['L-76']]);
  const b = await one(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('B-202', $1, $2, 500) returning id`, [black, id['L-75']]);
  const b1 = await one(`insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('B-001', (select id from fabric_qualities where name = 'Mono White'), $1, 3000) returning id`, [id['L-76']]);
  const b2 = await one(`insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('B-002', (select id from fabric_qualities where name = 'White/Black'), $1, 2000) returning id`, [id['L-75']]);
  await s.query(
    `insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $3, 'warp', 400), ($1, $3, 'weft', 300), ($2, $3, 'warp', 250), ($2, $4, 'weft', 200)`,
    [b1, b2, a, b],
  );
  id['L76-05'] = await db.id('looms', 'machine_no', 'L76-05');
  id['L75-12'] = await db.id('looms', 'machine_no', 'L75-12');
  await loadBeam(owner, b1, id['L76-05']);
  await loadBeam(owner, b2, id['L75-12']);
  await recordTakeoff(owner, { loom_id: id['L76-05'], meters: 1200, kgs: 650, entry_date: today, finish_beam: false });
  await recordTakeoff(owner, { loom_id: id['L75-12'], meters: 800, kgs: 420, entry_date: today, finish_beam: false });
  // an older take-off that must not count as "today"
  await recordTakeoff(owner, { loom_id: id['L76-05'], meters: 10, kgs: 5, entry_date: '2026-01-01', finish_beam: false });
});

afterAll(async () => {
  await gw?.close();
  await db?.close();
});

describe('dashboard numbers', () => {
  it('all factories: yarn, grey, looms, today', async () => {
    const d = await loadDashboard(owner, { today });
    expect(round(d.yarnKg)).toBe(350); // A-101 50 + B-202 300
    expect([round(d.greyM, 2), round(d.greyKg)]).toEqual([2010, 1075]);
    expect([d.looms.length, d.running, d.idle, d.maintenance]).toEqual([68, 2, 66, 0]);
    expect([round(d.todayM, 2), round(d.todayKg!), d.todayTakeoffs]).toEqual([2000, 1070, 2]);
    expect([d.todayWastedM, d.todayNetM, d.todayWastagePct]).toEqual([0, 2000, 0]);
    expect(d.grey.map((g) => [g.fabric_quality_name, round(g.stock_m, 2)])).toEqual([['Mono White', 1210], ['White/Black', 800]]);
    const low = d.yarn.find((y) => y.yarn_quality_name === 'Mono 0.25 White')!;
    expect([low.balance_kg, low.is_low_stock]).toEqual([50, true]); // below the 200 kg level
  });

  it('one factory: only its looms, grey and production; yarn by receiving factory', async () => {
    const d = await loadDashboard(owner, { today, factoryId: id['L-75'] });
    expect([d.looms.length, d.running, d.idle]).toEqual([32, 1, 31]);
    expect([round(d.greyM, 2), round(d.greyKg)]).toEqual([800, 420]);
    expect([round(d.todayM, 2), round(d.todayKg!)]).toEqual([800, 420]);
    expect(round(d.yarnKg)).toBe(300); // B-202 was received at L-75
    expect(d.yarn.every((y) => y.is_low_stock === null)).toBe(true);
  });

  it('factory-scoped users only see their factory in production and grey numbers', async () => {
    const d = await loadDashboard(entry76, { today });
    expect([round(d.todayM, 2), round(d.greyM, 2)]).toEqual([1200, 1210]);
    expect(d.looms.length).toBe(68); // the loom grid itself is shared
    expect((await productionOn(entry76, today)).map((r) => r.machine_no)).toEqual(['L76-05']);
  });
});

describe('realtime change feed', () => {
  it('a subscribed client hears about a new take-off', async () => {
    const listener = await signIn('owner@test.local');
    const events: { table: string; eventType: string }[] = [];
    const subscribed = new Promise<void>((resolve, reject) => {
      listener
        .channel('test-dashboard')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'grey_fabric_production' }, (p) => events.push({ table: p.table, eventType: p.eventType }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'beams' }, (p) => events.push({ table: p.table, eventType: p.eventType }))
        .subscribe((status, err) => (status === 'SUBSCRIBED' ? resolve() : status !== 'CLOSED' && err ? reject(err) : undefined));
    });
    await subscribed;

    await recordTakeoff(entry76, { loom_id: id['L76-05'], meters: 1, kgs: 1, entry_date: today, finish_beam: true });
    await expect.poll(() => events, { timeout: 5000 }).toEqual(
      expect.arrayContaining([
        { table: 'grey_fabric_production', eventType: 'INSERT' },
        { table: 'beams', eventType: 'UPDATE' },
      ]),
    );
    await listener.removeAllChannels();
  });
});

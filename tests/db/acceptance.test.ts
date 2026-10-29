// §8 acceptance test, run end-to-end as an authenticated owner — i.e. exactly
// what a PostgREST request from the app would do, with RLS switched on.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, num, pgError, type TestDb } from './db';

let db: TestDb;
let owner: pg.Client;
const ids: Record<string, string> = {};

async function lotBalance(lotNo: string) {
  const { rows } = await owner.query('select balance_kg from v_yarn_lot_balance where lot_no = $1', [lotNo]);
  return num(rows[0].balance_kg);
}

async function loomCounts() {
  const { rows } = await owner.query(
    `select count(*) filter (where status = 'running') as running,
            count(*) filter (where status = 'idle') as idle,
            count(*) as total
     from v_loom_status where active`,
  );
  return { running: num(rows[0].running), idle: num(rows[0].idle), total: num(rows[0].total) };
}

async function greyTotal() {
  const { rows } = await owner.query('select sum(stock_m) as m, sum(stock_kg) as kg from v_grey_stock');
  return { m: num(rows[0].m), kg: num(rows[0].kg) };
}

async function consume(beam: string, lot: string, usage: 'warp' | 'weft', kgs: number) {
  await owner.query('insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, $3, $4)', [
    ids[beam], ids[lot], usage, kgs,
  ]);
}

beforeAll(async () => {
  db = await freshDb();
  const ownerId = await db.createUser({ email: 'owner@example.com', role: 'owner' });
  owner = await db.as(ownerId);
  ids['L-76'] = await db.id('factories', 'code', 'L-76');
  ids['L-75'] = await db.id('factories', 'code', 'L-75');
  ids.white = await db.id('yarn_qualities', 'name', 'Mono 0.25 White');
  ids.black = await db.id('yarn_qualities', 'name', 'Mono 0.25 Black');
  ids['Mono White'] = await db.id('fabric_qualities', 'name', 'Mono White');
  ids['White/Black'] = await db.id('fabric_qualities', 'name', 'White/Black');
  ids['L76-05'] = await db.id('looms', 'machine_no', 'L76-05');
  ids['L75-12'] = await db.id('looms', 'machine_no', 'L75-12');
});

afterAll(async () => {
  await db?.close();
});

describe('§8 acceptance', () => {
  it('1. inwards lot A-101 (Mono White, 1,000 kg) and B-202 (Mono Black, 500 kg)', async () => {
    const ins = 'insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ($1, $2, $3, $4) returning id';
    ids['A-101'] = (await owner.query(ins, ['A-101', ids.white, ids['L-76'], 1000])).rows[0].id;
    ids['B-202'] = (await owner.query(ins, ['B-202', ids.black, ids['L-75'], 500])).rows[0].id;
    expect(await lotBalance('A-101')).toBe(1000);
    expect(await lotBalance('B-202')).toBe(500);
  });

  it('2. beam B-001 (Mono White): warp 400 + weft 300 from A-101 → A-101 = 300 kg', async () => {
    ids['B-001'] = (
      await owner.query(
        `insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('B-001', $1, $2, 3000) returning id`,
        [ids['Mono White'], ids['L-76']],
      )
    ).rows[0].id;
    await consume('B-001', 'A-101', 'warp', 400);
    await consume('B-001', 'A-101', 'weft', 300);
    expect(await lotBalance('A-101')).toBe(300);
  });

  it('3. beam B-002 (White/Black): warp 250 from A-101, weft 200 from B-202 → A-101 = 50, B-202 = 300', async () => {
    ids['B-002'] = (
      await owner.query(
        `insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('B-002', $1, $2, 2000) returning id`,
        [ids['White/Black'], ids['L-75']],
      )
    ).rows[0].id;
    await consume('B-002', 'A-101', 'warp', 250);
    await consume('B-002', 'B-202', 'weft', 200);
    expect(await lotBalance('A-101')).toBe(50);
    expect(await lotBalance('B-202')).toBe(300);
  });

  it('4. 100 kg more warp from A-101 is blocked and says 50 kg is available', async () => {
    const err = await pgError(() => consume('B-002', 'A-101', 'warp', 100));
    expect(err.code).toBe('WV001');
    expect(err.message).toBe('Not enough yarn in lot A-101: 50.000 kg available, 100.000 kg requested');
    expect(JSON.parse(err.detail!)).toEqual({ lot_no: 'A-101', available_kg: 50, requested_kg: 100 });
    expect(await lotBalance('A-101')).toBe(50);
  });

  it('5. B-001 on L76-05; B-002 on L76-05 blocked; B-002 on L75-12 → 2 running, 66 idle', async () => {
    await owner.query('select load_beam($1, $2)', [ids['B-001'], ids['L76-05']]);

    const err = await pgError(() => owner.query('select load_beam($1, $2)', [ids['B-002'], ids['L76-05']]));
    expect(err.code).toBe('WV002');
    expect(err.message).toContain('Loom L76-05 already has beam B-001 running');

    await owner.query('select load_beam($1, $2)', [ids['B-002'], ids['L75-12']]);
    expect(await loomCounts()).toEqual({ running: 2, idle: 66, total: 68 });
  });

  it('6. take-offs 1,200 m / 650 kg and 800 m / 420 kg → grey stock 2,000 m / 1,070 kg, split by quality and factory', async () => {
    await owner.query('select record_takeoff($1, 1200, 650)', [ids['L76-05']]);
    await owner.query('select record_takeoff($1, 800, 420)', [ids['L75-12']]);

    expect(await greyTotal()).toEqual({ m: 2000, kg: 1070 });

    const { rows } = await owner.query(
      'select fabric_quality_name, factory_code, stock_m, stock_kg from v_grey_stock order by fabric_quality_name',
    );
    expect(rows.map((r) => [r.fabric_quality_name, r.factory_code, num(r.stock_m), num(r.stock_kg)])).toEqual([
      ['Mono White', 'L-76', 1200, 650],
      ['White/Black', 'L-75', 800, 420],
    ]);
  });

  it('7. B-001 wastage = 700 − 650 = 50 kg (7.14%)', async () => {
    const { rows } = await owner.query(
      `select total_yarn_kg, grey_kg, wastage_kg, wastage_pct from v_beam_summary where beam_no = 'B-001'`,
    );
    expect(num(rows[0].total_yarn_kg)).toBe(700);
    expect(num(rows[0].grey_kg)).toBe(650);
    expect(num(rows[0].wastage_kg)).toBe(50);
    expect(num(rows[0].wastage_pct)).toBe(7.14);
  });

  it('8. dispatch 500 m / 270 kg of Mono White → grey stock 1,500 m / 800 kg', async () => {
    await owner.query(
      `insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters, kgs, party) values ($1, $2, 500, 270, 'Test Party')`,
      [ids['Mono White'], ids['L-76']],
    );
    expect(await greyTotal()).toEqual({ m: 1500, kg: 800 });
  });

  it('9. finishing B-001 frees L76-05', async () => {
    await owner.query('select finish_beam($1)', [ids['B-001']]);
    const { rows } = await owner.query(`select status, beam_no from v_loom_status where machine_no = 'L76-05'`);
    expect(rows[0]).toEqual({ status: 'idle', beam_no: null });
    expect(await loomCounts()).toEqual({ running: 1, idle: 67, total: 68 });
  });
});

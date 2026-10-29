// Roles and row-level security (§6 Auth & roles).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, num, pgError, type TestDb } from './db';

let db: TestDb;
const id: Record<string, string> = {};
let owner: pg.Client, sup76: pg.Client, entry76: pg.Client, inactive: pg.Client;

beforeAll(async () => {
  db = await freshDb();
  id['L-76'] = await db.id('factories', 'code', 'L-76');
  id['L-75'] = await db.id('factories', 'code', 'L-75');
  id.white = await db.id('yarn_qualities', 'name', 'Mono 0.25 White');
  id.fq = await db.id('fabric_qualities', 'name', 'Mono White');

  owner = await db.as(await db.createUser({ email: 'o@example.com', role: 'owner' }));
  sup76 = await db.as(await db.createUser({ email: 's@example.com', role: 'supervisor', factoryCode: 'L-76' }));
  entry76 = await db.as(await db.createUser({ email: 'd@example.com', role: 'data_entry', factoryCode: 'L-76' }));
  const { rows } = await db.sql.query(`insert into auth.users (email) values ('new@example.com') returning id`);
  inactive = await db.as(rows[0].id);

  // Some data in both factories (as service)
  id.lot76 = (await db.sql.query(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('R-76', $1, $2, 500) returning id`, [id.white, id['L-76']])).rows[0].id;
  id.lot75 = (await db.sql.query(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('R-75', $1, $2, 500) returning id`, [id.white, id['L-75']])).rows[0].id;
  id.beam75 = (await db.sql.query(`insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('RB-75', $1, $2, 1000) returning id`, [id.fq, id['L-75']])).rows[0].id;
  await db.sql.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'warp', 100)`, [id.beam75, id.lot76]);
});
afterAll(async () => {
  await db?.close();
});

describe('user bootstrap', () => {
  it('the first sign-up becomes an active owner; later sign-ups are inactive data_entry', async () => {
    const fresh = await (await import('./db')).freshDb();
    try {
      await fresh.sql.query(`delete from app_users`);
      await fresh.sql.query(`insert into auth.users (email, raw_user_meta_data) values ('boss@example.com', '{"name":"Boss"}'), ('next@example.com', '{}')`);
      const { rows } = await fresh.sql.query(`select name, role, active from app_users order by email`);
      expect(rows).toEqual([
        { name: 'Boss', role: 'owner', active: true },
        { name: 'next', role: 'data_entry', active: false },
      ]);
    } finally {
      await fresh.close();
    }
  });

  it('inactive users see nothing and cannot write', async () => {
    expect((await inactive.query('select * from looms')).rowCount).toBe(0);
    expect((await inactive.query('select * from v_yarn_lot_balance')).rowCount).toBe(0);
    const err = await pgError(() => inactive.query(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('X', $1, $2, 1)`, [id.white, id['L-76']]));
    expect(err.code).toBe('42501');
  });
});

describe('factory scoping', () => {
  it('owner sees beams in both factories; L-76 staff only see L-76 beams', async () => {
    expect((await owner.query(`select 1 from beams where id = $1`, [id.beam75])).rowCount).toBe(1);
    expect((await sup76.query(`select 1 from beams where id = $1`, [id.beam75])).rowCount).toBe(0);
    expect((await entry76.query(`select 1 from beams where id = $1`, [id.beam75])).rowCount).toBe(0);
  });

  it('yarn is shared: everyone sees every lot with the correct balance (incl. other factories’ consumption)', async () => {
    const { rows } = await entry76.query(`select lot_no, balance_kg from v_yarn_lot_balance order by lot_no`);
    expect(rows.map((r) => [r.lot_no, num(r.balance_kg)])).toEqual([['R-75', 500], ['R-76', 400]]);
  });

  it('L-76 staff cannot add entries for L-75', async () => {
    const lot = await pgError(() => entry76.query(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('X-75', $1, $2, 1)`, [id.white, id['L-75']]));
    expect(lot.code).toBe('42501');
    const cons = await pgError(() => sup76.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'weft', 1)`, [id.beam75, id.lot76]));
    expect(cons.code).toBe('42501');
    const load = await pgError(() => entry76.query(`select load_beam($1, (select id from looms where machine_no = 'L75-01'))`, [id.beam75]));
    expect(load.code).toBe('WV005');
  });

  it('L-76 staff only see L-76 looms in production terms, but the loom grid lists all 68 looms', async () => {
    expect((await entry76.query(`select 1 from v_loom_status`)).rowCount).toBe(68);
  });
});

describe('data_entry: add only', () => {
  let beam: string;

  it('can add a lot, a beam, consumption, load the beam, record a take-off and finish it', async () => {
    const lot = (await entry76.query(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('DE-1', $1, $2, 200) returning id`, [id.white, id['L-76']])).rows[0].id;
    beam = (await entry76.query(`insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('DE-B1', $1, $2, 1000) returning id`, [id.fq, id['L-76']])).rows[0].id;
    await entry76.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'warp', 50)`, [beam, lot]);
    await entry76.query(`select load_beam($1, (select id from looms where machine_no = 'L76-01'))`, [beam]);
    await entry76.query(`select record_takeoff((select id from looms where machine_no = 'L76-01'), 100, 45, p_finish_beam => true)`);
    const s = (await entry76.query(`select status, grey_meters from v_beam_summary where beam_id = $1`, [beam])).rows[0];
    expect(s.status).toBe('finished');
    expect(num(s.grey_meters)).toBe(100);
  });

  it('cannot edit or delete (rows silently unaffected)', async () => {
    expect((await entry76.query(`update yarn_lots set kgs_received = 1 where lot_no = 'DE-1'`)).rowCount).toBe(0);
    expect((await entry76.query(`delete from yarn_consumption where beam_id = $1`, [beam])).rowCount).toBe(0);
    expect((await entry76.query(`update beams set warp_length_m = 1 where id = $1`, [beam])).rowCount).toBe(0);
    expect((await entry76.query(`delete from grey_fabric_production where beam_id = $1`, [beam])).rowCount).toBe(0);
  });

  it('cannot create stock adjustments, masters or looms', async () => {
    expect((await pgError(() => entry76.query(`insert into stock_adjustments (item_type, yarn_lot_id, factory_id, kgs, reason) values ('yarn_lot', $1, $2, -1, 'x')`, [id.lot76, id['L-76']]))).code).toBe('42501');
    expect((await pgError(() => entry76.query(`insert into suppliers (name) values ('No')`))).code).toBe('42501');
    expect((await pgError(() => entry76.query(`insert into looms (factory_id, machine_no) values ($1, 'L76-99')`, [id['L-76']]))).code).toBe('42501');
  });
});

describe('supervisor', () => {
  it('can edit and delete within their factory and make adjustments (as approver)', async () => {
    expect((await sup76.query(`update yarn_lots set challan_no = 'CH-1' where id = $1`, [id.lot76])).rowCount).toBe(1);
    const adj = (await sup76.query(`insert into stock_adjustments (item_type, yarn_lot_id, factory_id, kgs, reason) values ('yarn_lot', $1, $2, -2, 'count') returning approved_by, created_by`, [id.lot76, id['L-76']])).rows[0];
    expect(adj.approved_by).toBe(adj.created_by);
  });

  it('cannot edit the other factory, looms, settings or users', async () => {
    expect((await sup76.query(`update yarn_lots set challan_no = 'CH-2' where id = $1`, [id.lot75])).rowCount).toBe(0);
    expect((await sup76.query(`update looms set notes = 'x'`)).rowCount).toBe(0);
    expect((await sup76.query(`update app_settings set value = '1'`)).rowCount).toBe(0);
    expect((await sup76.query(`update app_users set role = 'owner'`)).rowCount).toBe(0);
  });
});

describe('owner', () => {
  it('manages looms and users, and reads the audit log', async () => {
    await owner.query(`insert into looms (factory_id, machine_no, sort_order) values ($1, 'L76-37', 37)`, [id['L-76']]);
    await owner.query(`update looms set machine_no = 'L76-37A' where machine_no = 'L76-37'`);
    expect((await owner.query(`update app_users set active = true where email = 'new@example.com'`)).rowCount).toBe(1);
    expect((await owner.query(`select 1 from audit_log where table_name = 'looms' and action = 'UPDATE'`)).rowCount).toBeGreaterThan(0);
    expect((await sup76.query(`select 1 from audit_log`)).rowCount).toBe(0);
  });

  it('nobody can write the audit log directly', async () => {
    expect((await pgError(() => owner.query(`delete from audit_log`))).code).toBe('42501');
  });
});

describe('anon', () => {
  it('has no access to any table', async () => {
    const anon = await db.as('00000000-0000-0000-0000-000000000000');
    await anon.query('set role anon');
    expect((await pgError(() => anon.query('select * from looms'))).code).toBe('42501');
  });
});

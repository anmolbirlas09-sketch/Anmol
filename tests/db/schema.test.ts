// Phase 1: seed data, views, planning formulas, audit trail.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, num, type TestDb } from './db';

let db: TestDb;

beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db?.close();
});

describe('seed', () => {
  it('has factories L-76 (36 looms) and L-75 (32 looms), 68 in total, all idle', async () => {
    const { rows } = await db.sql.query(
      `select f.code, count(l.*) as looms, min(l.machine_no) as first, max(l.machine_no) as last,
              bool_and(l.status = 'idle' and l.active) as all_idle
       from factories f join looms l on l.factory_id = f.id
       group by f.code, f.sort_order order by f.sort_order`,
    );
    expect(rows.map((r) => [r.code, num(r.looms), r.first, r.last, r.all_idle])).toEqual([
      ['L-76', 36, 'L76-01', 'L76-36', true],
      ['L-75', 32, 'L75-01', 'L75-32', true],
    ]);
  });

  it('reference-data migration is idempotent', async () => {
    const { readSql, schemaFiles } = await import('./db');
    const ref = schemaFiles().find((f) => f.endsWith('_reference_data.sql'))!;
    await db.sql.query(readSql(ref));
    const { rows } = await db.sql.query('select count(*) from looms');
    expect(num(rows[0].count)).toBe(68);
  });

  it('has sample yarn and fabric qualities; White/Black uses different warp and weft yarn', async () => {
    const { rows } = await db.sql.query(
      `select fq.name, w.name as warp, f.name as weft from fabric_qualities fq
       join yarn_qualities w on w.id = fq.warp_yarn_quality_id
       join yarn_qualities f on f.id = fq.weft_yarn_quality_id
       where fq.name in ('Mono White', 'White/Black') order by fq.name`,
    );
    expect(rows).toEqual([
      { name: 'Mono White', warp: 'Mono 0.25 White', weft: 'Mono 0.25 White' },
      { name: 'White/Black', warp: 'Mono 0.25 White', weft: 'Mono 0.25 Black' },
    ]);
  });

  it('defaults the variance threshold to 5%', async () => {
    const { rows } = await db.sql.query(`select value from app_settings where key = 'variance_threshold_pct'`);
    expect(rows[0].value).toBe(5);
  });

  it('starts with empty stock views', async () => {
    for (const v of ['v_yarn_lot_balance', 'v_yarn_ledger', 'v_grey_ledger', 'v_grey_stock', 'v_grey_stock_by_quality', 'v_beam_summary']) {
      const { rows } = await db.sql.query(`select count(*) from ${v}`);
      expect(num(rows[0].count), v).toBe(0);
    }
    const { rows } = await db.sql.query(`select count(*) from v_loom_status`);
    expect(num(rows[0].count)).toBe(68);
  });
});

describe('planning formulas (§4)', () => {
  it('computes planned warp and weft kg from the fabric quality master', async () => {
    // 1800 ends × 3000 m × 420 den ÷ 9e6 × 1.03 = 259.560 kg
    // fabric length 3000 ÷ 1.03 = 2912.62 m
    // 24 ppi × 39.37 × 1.8 m × 2912.62 m × 420 den ÷ 9e6 × 1.02 = 235.798 kg
    const { rows } = await db.sql.query(`
      select planned_warp_kg(1800, 3000, 420, 3) as warp,
             expected_fabric_length_m(3000, 3) as len,
             planned_weft_kg(24, 1.8, expected_fabric_length_m(3000, 3), 420, 2) as weft,
             planned_warp_kg(null, 3000, 420, 3) as missing,
             variance_pct(270, 259.56) as var`);
    expect(num(rows[0].warp)).toBe(259.56);
    expect(num(rows[0].len)).toBe(2912.62);
    expect(num(rows[0].weft)).toBe(235.798);
    expect(rows[0].missing).toBeNull();
    expect(num(rows[0].var)).toBe(4.02);
  });

  it('shows planned vs actual on the beam summary and flags variance over the threshold', async () => {
    const fq = await db.id('fabric_qualities', 'name', 'Mono White');
    const f = await db.id('factories', 'code', 'L-76');
    const yq = await db.id('yarn_qualities', 'name', 'Mono 0.25 White');
    const lot = (await db.sql.query(
      `insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('P-1', $1, $2, 1000) returning id`, [yq, f],
    )).rows[0].id;
    const beam = (await db.sql.query(
      `insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('P-B1', $1, $2, 3000) returning id`, [fq, f],
    )).rows[0].id;
    await db.sql.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'warp', 270), ($1, $2, 'weft', 260)`, [beam, lot]);

    const { rows } = await db.sql.query(`select * from v_beam_summary where beam_id = $1`, [beam]);
    const r = rows[0];
    expect(num(r.planned_warp_kg)).toBe(259.56);
    expect(num(r.warp_variance_pct)).toBe(4.02);
    expect(r.warp_variance_flag).toBe(false);
    expect(num(r.weft_variance_pct)).toBe(10.26);
    expect(r.weft_variance_flag).toBe(true);

    await db.sql.query(`update app_settings set value = '12' where key = 'variance_threshold_pct'`);
    const again = (await db.sql.query(`select weft_variance_flag from v_beam_summary where beam_id = $1`, [beam])).rows[0];
    expect(again.weft_variance_flag).toBe(false);
  });

  it('shows planned as null (—) when quality data is missing, but still accepts actuals', async () => {
    const f = await db.id('factories', 'code', 'L-76');
    const fq = (await db.sql.query(`insert into fabric_qualities (name) values ('Bare Quality') returning id`)).rows[0].id;
    const yq = await db.id('yarn_qualities', 'name', 'Mono 0.25 Black');
    const lot = (await db.sql.query(
      `insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('P-2', $1, $2, 100) returning id`, [yq, f],
    )).rows[0].id;
    const beam = (await db.sql.query(
      `insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('P-B2', $1, $2, 1000) returning id`, [fq, f],
    )).rows[0].id;
    await db.sql.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'warp', 10)`, [beam, lot]);
    const r = (await db.sql.query(`select * from v_beam_summary where beam_id = $1`, [beam])).rows[0];
    expect(r.planned_warp_kg).toBeNull();
    expect(r.warp_variance_pct).toBeNull();
    expect(r.warp_variance_flag).toBe(false);
    expect(num(r.warp_kg)).toBe(10);
  });
});

describe('yarn views', () => {
  it('rolls lot balances up by quality, with a low-stock flag', async () => {
    const { rows } = await db.sql.query(
      `select yarn_quality_name, balance_kg, reorder_level_kg, is_low_stock from v_yarn_stock_by_quality
       where yarn_quality_name in ('Mono 0.25 White', 'Mono 0.25 Black') order by 1`,
    );
    // From the planning tests above: P-1 1000 − 530 = 470 (white); P-2 100 − 10 = 90 (black, below 200).
    expect(rows.map((r) => [r.yarn_quality_name, num(r.balance_kg), r.is_low_stock])).toEqual([
      ['Mono 0.25 Black', 90, true],
      ['Mono 0.25 White', 470, false],
    ]);
  });

  it('ledger has one signed row per movement and sums to the balance', async () => {
    const { rows } = await db.sql.query(
      `select l.lot_no, sum(l.kgs) as ledger, max(b.balance_kg) as balance
       from v_yarn_ledger l join v_yarn_lot_balance b using (yarn_lot_id) group by l.lot_no order by 1`,
    );
    for (const r of rows) expect(num(r.ledger)).toBe(num(r.balance));
  });
});

describe('audit trail', () => {
  it('stamps created_by from the JWT and logs every insert/update/delete', async () => {
    const uid = await db.createUser({ email: 'sup@example.com', role: 'supervisor' });
    const sup = await db.as(uid);
    const { rows } = await sup.query(`insert into suppliers (name) values ('Audit Supplier') returning id, created_by`);
    expect(rows[0].created_by).toBe(uid);
    await sup.query(`update suppliers set contact = 'Navsari' where id = $1`, [rows[0].id]);
    await db.sql.query(`delete from suppliers where id = $1`, [rows[0].id]);

    const log = await db.sql.query(
      `select action, changed_by, old_data->>'contact' as old_contact, new_data->>'contact' as new_contact
       from audit_log where table_name = 'suppliers' and record_id = $1 order by id`,
      [rows[0].id],
    );
    expect(log.rows).toEqual([
      { action: 'INSERT', changed_by: uid, old_contact: null, new_contact: null },
      { action: 'UPDATE', changed_by: uid, old_contact: null, new_contact: 'Navsari' },
      { action: 'DELETE', changed_by: null, old_contact: 'Navsari', new_contact: null },
    ]);
  });

  it('prevents a caller from spoofing created_by', async () => {
    const uid = await db.createUser({ email: 'spoof@example.com', role: 'supervisor' });
    const sup = await db.as(uid);
    const other = '00000000-0000-0000-0000-000000000001';
    const { rows } = await sup.query(`insert into suppliers (name, created_by) values ('Spoof', $1) returning created_by`, [other]);
    expect(rows[0].created_by).toBe(uid);
  });
});

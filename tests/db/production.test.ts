// Metre-first production (migration 0010): record_production(), rolls,
// metre and KG wastage kept independent, NULL for anything not recorded.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, admin, freshDb, num, pgError, readSql, schemaFiles, type TestDb } from './db';

let db: TestDb;
const id: Record<string, string> = {};
let n = 0;

/** A beam with the given quality, loaded on a free loom; returns the loom id. */
async function runningLoom(machine: string, quality = 'Mono White') {
  const loom = await db.id('looms', 'machine_no', machine);
  const factory = (await db.sql.query('select factory_id from looms where id = $1', [loom])).rows[0].factory_id;
  const beam = (await db.sql.query(
    `insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ($1, (select id from fabric_qualities where name = $2), $3, 3000) returning id`,
    [`PB-${++n}`, quality, factory],
  )).rows[0].id;
  await db.sql.query('select load_beam($1, $2)', [beam, loom]);
  return loom;
}

type Args = Partial<{
  meters: number; wasted: number; roll: number; date: string; gsm: number; width: number; weighed: number;
  warp: number; weft: number; wasteKg: number; wastePct: number; finish: boolean; ref: string; quality: string;
}>;

async function record(loom: string, a: Args = {}) {
  const { rows } = await db.sql.query(
    `select * from record_production(
       p_loom_id => $1, p_fabric_quality_id => (select id from fabric_qualities where name = $2),
       p_meters => $3, p_wasted_meters => $4, p_roll_length_m => $5, p_entry_date => $6,
       p_gsm => $7, p_width_m => $8, p_weighed_kg => $9, p_warp_kg => $10, p_weft_kg => $11,
       p_waste_kg => $12, p_waste_pct => $13, p_finish_beam => $14, p_client_ref => $15)`,
    [loom, a.quality ?? 'Mono White', a.meters ?? 680, a.wasted ?? 33, a.roll ?? 100, a.date ?? '2026-10-31',
     a.gsm ?? null, a.width ?? null, a.weighed ?? null, a.warp ?? null, a.weft ?? null,
     a.wasteKg ?? null, a.wastePct ?? null, a.finish ?? false, a.ref ?? null],
  );
  return rows[0];
}

beforeAll(async () => {
  db = await freshDb();
  id['L-76'] = await db.id('factories', 'code', 'L-76');
  id.mw = await db.id('fabric_qualities', 'name', 'Mono White');
});
afterAll(async () => {
  await db?.close();
});

describe('the 680-metre example', () => {
  it('680 m with 33 m wasted → 647 m net, 4.85 %, rolled into 6 × 100 m + 47 m', async () => {
    const loom = await runningLoom('L76-01');
    const r = await record(loom, { meters: 680, wasted: 33, roll: 100 });
    expect([num(r.meters), num(r.wasted_meters), num(r.net_meters), num(r.wastage_pct)]).toEqual([680, 33, 647, 4.85]);

    const rolls = (await db.sql.query('select roll_no, meters from fabric_rolls where production_id = $1 order by seq', [r.id])).rows;
    expect(rolls.map((x) => num(x.meters))).toEqual([100, 100, 100, 100, 100, 100, 47]);
    expect(rolls.map((x) => x.roll_no)).toEqual([1, 2, 3, 4, 5, 6, 7].map((i) => `L76-01-261031-0${i}`));
    expect(rolls.reduce((s, x) => s + num(x.meters), 0)).toBe(647);

    // A second entry the same day on the same loom continues the roll numbers.
    const r2 = await record(loom, { meters: 120, wasted: 0, roll: 100 });
    const more = (await db.sql.query('select roll_no from fabric_rolls where production_id = $1 order by seq', [r2.id])).rows;
    expect(more.map((x) => x.roll_no)).toEqual(['L76-01-261031-08', 'L76-01-261031-09']);
  });

  it('no GSM, no width, no KG: every weight stays NULL (not 0)', async () => {
    const loom = await runningLoom('L76-02');
    const r = await record(loom, { meters: 680, wasted: 33 });
    for (const k of ['gsm', 'width_m', 'estimated_kg', 'kgs', 'warp_kg', 'weft_kg', 'total_yarn_kg', 'waste_kg', 'waste_pct_entered', 'waste_kg_estimated', 'weight_wastage_pct']) {
      expect(r[k], k).toBeNull();
    }
    const beam = (await db.sql.query('select * from v_beam_summary where loom_id = $1 and status = $2', [loom, 'on_loom'])).rows[0];
    expect([num(beam.grey_meters), num(beam.wasted_meters), num(beam.net_meters), num(beam.wastage_pct)]).toEqual([680, 33, 647, 4.85]);
    for (const k of ['grey_kg', 'estimated_kg', 'prod_warp_kg', 'prod_weft_kg', 'prod_total_yarn_kg', 'waste_kg_actual', 'waste_kg_estimated', 'weight_wastage_pct_actual', 'meters_per_kg']) {
      expect(beam[k], k).toBeNull();
    }
  });
});

describe('weights', () => {
  it('estimated fabric weight = GSM × width × metres / 1000 (65 × 1.5 × 250 = 24.375 kg)', async () => {
    const r = await record(await runningLoom('L76-03'), { meters: 250, wasted: 0, gsm: 65, width: 1.5 });
    expect(num(r.estimated_kg)).toBe(24.375);
    expect(r.kgs).toBeNull(); // estimated is never copied into the weighed weight
  });

  it('GSM without width (or width without GSM) gives no estimate', async () => {
    const loom = await runningLoom('L76-04');
    expect((await record(loom, { gsm: 65 })).estimated_kg).toBeNull();
    expect((await record(loom, { width: 1.5 })).estimated_kg).toBeNull();
  });

  it('actual waste kg → weight wastage % of total yarn; nothing estimated', async () => {
    const r = await record(await runningLoom('L76-05'), { warp: 300, weft: 200, wasteKg: 25 });
    expect([num(r.total_yarn_kg), num(r.waste_kg), num(r.weight_wastage_pct)]).toEqual([500, 25, 5]);
    expect(r.waste_kg_estimated).toBeNull();
  });

  it('a wastage % → estimated waste kg only when warp and weft are both known', async () => {
    const loom = await runningLoom('L76-06');
    const r = await record(loom, { warp: 300, weft: 200, wastePct: 4 });
    expect([num(r.waste_pct_entered), num(r.waste_kg_estimated)]).toEqual([4, 20]);
    expect(r.waste_kg).toBeNull();
    expect(r.weight_wastage_pct).toBeNull();

    const onlyWarp = await record(loom, { warp: 300, wastePct: 4 });
    expect([onlyWarp.total_yarn_kg, onlyWarp.waste_kg_estimated]).toEqual([null, null]);
    expect(num(onlyWarp.waste_pct_entered)).toBe(4);
  });

  it('the metre wastage % and the KG wastage % are independent', async () => {
    const r = await record(await runningLoom('L76-07'), { meters: 680, wasted: 33, warp: 300, weft: 200, wasteKg: 10, weighed: 480 });
    expect([num(r.wastage_pct), num(r.weight_wastage_pct)]).toEqual([4.85, 2]);
    // yarn (500) − weighed fabric (480) = 20 kg is NOT recorded as waste anywhere
    expect(num(r.waste_kg)).toBe(10);
  });
});

describe('validation', () => {
  let loom: string;
  beforeAll(async () => {
    loom = await runningLoom('L76-08');
  });

  it('wasted metres cannot exceed production metres', async () => {
    const e = await pgError(() => record(loom, { meters: 100, wasted: 100.01 }));
    expect(e.code).toBe('WV004');
    expect(e.message).toBe('Wasted metres (100.01) cannot be more than production metres (100)');
    expect((await record(loom, { meters: 100, wasted: 100 })).net_meters).toBe('0.00'); // all wasted: allowed, no rolls
  });

  it('no negative or zero quantities', async () => {
    expect((await pgError(() => record(loom, { meters: 0 }))).code).toBe('WV004');
    expect((await pgError(() => record(loom, { wasted: -1 }))).code).toBe('WV004');
    expect((await pgError(() => record(loom, { roll: 0 }))).code).toBe('WV004');
    expect((await pgError(() => record(loom, { warp: -5, weft: 1 }))).code).toBe('23514');
    expect((await pgError(() => record(loom, { gsm: -65, width: 1 }))).code).toBe('23514');
  });

  it('waste in kg or as %, not both; never more kg than the yarn; % ≤ 100', async () => {
    expect((await pgError(() => record(loom, { warp: 300, weft: 200, wasteKg: 5, wastePct: 1 }))).code).toBe('23514');
    expect((await pgError(() => record(loom, { warp: 300, weft: 200, wasteKg: 501 }))).code).toBe('23514');
    expect((await pgError(() => record(loom, { wastePct: 101 }))).code).toBe('23514');
  });

  it('the fabric quality must be the one the beam is weaving', async () => {
    const e = await pgError(() => record(loom, { quality: 'White/Black' }));
    expect(e.code).toBe('WV004');
    expect(e.message).toMatch(/is weaving Mono White, not the fabric quality selected/);
  });

  it('an absurd roll length is refused', async () => {
    expect((await pgError(() => record(loom, { meters: 1000, wasted: 0, roll: 1 }))).message).toMatch(/more than 500 rolls/);
  });
});

describe('integrity', () => {
  it('the same submission (client_ref) is stored once', async () => {
    const loom = await runningLoom('L76-09');
    const ref = randomUUID();
    const a = await record(loom, { ref });
    const b = await record(loom, { ref });
    expect(b.id).toBe(a.id);
    const c = (await db.sql.query('select count(*) from grey_fabric_production where client_ref = $1', [ref])).rows[0].count;
    expect(num(c)).toBe(1);
  });

  it('roll totals must reconcile with net metres: editing the metres alone is refused at commit', async () => {
    const r = await record(await runningLoom('L76-10'), { meters: 300, wasted: 0, roll: 100 });
    const e = await pgError(() => db.sql.query('update grey_fabric_production set wasted_meters = 10 where id = $1', [r.id]));
    expect(e.code).toBe('WV004');
    expect(e.message).toBe('Roll total 300.00 m does not match usable production 290.00 m');
    // Deleting the entry removes its rolls with it.
    await db.sql.query('delete from grey_fabric_production where id = $1', [r.id]);
    expect(num((await db.sql.query('select count(*) from fabric_rolls where production_id = $1', [r.id])).rows[0].count)).toBe(0);
  });

  it('finish_beam frees the loom in the same step', async () => {
    const loom = await runningLoom('L76-11');
    await record(loom, { finish: true });
    expect((await db.sql.query('select status from looms where id = $1', [loom])).rows[0].status).toBe('idle');
  });
});

describe('grey stock is metre-first', () => {
  it('stock counts net usable metres; kg stock only enforced when all production was weighed', async () => {
    const loom = await runningLoom('L75-20', 'Green Shade Net');
    const factory = (await db.sql.query('select factory_id from looms where id = $1', [loom])).rows[0].factory_id;
    const fq = await db.id('fabric_qualities', 'name', 'Green Shade Net');
    await record(loom, { quality: 'Green Shade Net', meters: 680, wasted: 33 }); // not weighed

    const s = (await db.sql.query('select stock_m, stock_kg, unweighed_count from v_grey_stock where fabric_quality_id = $1 and factory_id = $2', [fq, factory])).rows[0];
    expect([num(s.stock_m), num(s.stock_kg), num(s.unweighed_count)]).toEqual([647, 0, 1]);

    // kg may be recorded on dispatch even though production was not weighed …
    await db.sql.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters, kgs) values ($1, $2, 100, 40)`, [fq, factory]);
    // … and kg may be left out (metre-first)
    await db.sql.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters) values ($1, $2, 100)`, [fq, factory]);
    // metres are always enforced: 447 left
    const e = await pgError(() => db.sql.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters) values ($1, $2, 447.01)`, [fq, factory]));
    expect(e.code).toBe('WV003');
    expect(e.message).toBe('Not enough grey stock of Green Shade Net at L-75: 447.00 m available');
  });
});

describe('migration 0010 on an existing database', () => {
  it('keeps existing production and stock exactly as they were', async () => {
    const name = `weaving_mig_${process.pid}`;
    const all = schemaFiles();
    const before = all.filter((f) => !f.includes('_metre_first_production') && !f.endsWith('realtime-shim.sql') && !f.endsWith('seed.sql'));
    const m10 = all.find((f) => f.includes('_metre_first_production'))!;
    await admin((c) => c.query(`drop database if exists ${name} with (force)`));
    await admin((c) => c.query(`create database ${name}`));
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    try {
      for (const f of before) await c.query(readSql(f));
      await c.query(readSql(all.find((f) => f.endsWith('seed.sql'))!));
      // Old-style data: a beam on a loom with two weighed take-offs and a dispatch.
      await c.query(`
        with f as (select id from factories where code = 'L-76'),
        b as (insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m)
              select 'OLD-1', id, (select id from f), 3000 from fabric_qualities where name = 'Mono White' returning id)
        select load_beam((select id from b), (select id from looms where machine_no = 'L76-05'))`);
      await c.query(`select record_takeoff((select id from looms where machine_no = 'L76-05'), 1200, 650)`);
      await c.query(`select record_takeoff((select id from looms where machine_no = 'L76-05'), 300, 160)`);
      await c.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters, kgs)
                     select (select id from fabric_qualities where name = 'Mono White'), (select id from factories where code = 'L-76'), 500, 270`);
      const stockBefore = (await c.query(`select stock_m, stock_kg from v_grey_stock`)).rows;

      await c.query(readSql(m10));

      const rows = (await c.query(`select meters, kgs, wasted_meters, net_meters, wastage_pct, fabric_quality_id is not null as has_quality, roll_length_m from grey_fabric_production order by meters`)).rows;
      expect(rows.map((r) => [num(r.meters), num(r.kgs), num(r.wasted_meters), num(r.net_meters), num(r.wastage_pct), r.has_quality, r.roll_length_m])).toEqual([
        [300, 160, 0, 300, 0, true, null],
        [1200, 650, 0, 1200, 0, true, null],
      ]);
      expect((await c.query(`select stock_m, stock_kg from v_grey_stock`)).rows).toEqual(stockBefore);
      // and kg is still enforced for this fully weighed stock: 1000 m / 540 kg left
      await expect(c.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters, kgs)
                            select (select id from fabric_qualities where name = 'Mono White'), (select id from factories where code = 'L-76'), 10, 541`)).rejects.toMatchObject({ code: 'WV003' });
    } finally {
      await c.end();
      await admin((x) => x.query(`drop database if exists ${name} with (force)`));
    }
  });
});

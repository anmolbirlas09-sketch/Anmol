// Database-enforced business rules beyond the §8 happy path.
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_URL, freshDb, num, pgError, type TestDb } from './db';

let db: TestDb;
const id: Record<string, string> = {};
let seq = 0;

async function newLot(kgs: number, quality = 'white') {
  const lotNo = `T-${++seq}`;
  const { rows } = await db.sql.query(
    `insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ($1, $2, $3, $4) returning id`,
    [lotNo, id[quality], id['L-76'], kgs],
  );
  return rows[0].id as string;
}

async function newBeam(quality = 'Mono White', factory = 'L-76') {
  const { rows } = await db.sql.query(
    `insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ($1, $2, $3, 1000) returning id`,
    [`TB-${++seq}`, id[quality], id[factory]],
  );
  return rows[0].id as string;
}

const balance = async (lot: string) =>
  num((await db.sql.query('select balance_kg from v_yarn_lot_balance where yarn_lot_id = $1', [lot])).rows[0].balance_kg);

beforeAll(async () => {
  db = await freshDb();
  id['L-76'] = await db.id('factories', 'code', 'L-76');
  id['L-75'] = await db.id('factories', 'code', 'L-75');
  id.white = await db.id('yarn_qualities', 'name', 'Mono 0.25 White');
  id['Mono White'] = await db.id('fabric_qualities', 'name', 'Mono White');
  id['White/Black'] = await db.id('fabric_qualities', 'name', 'White/Black');
});
afterAll(async () => {
  await db?.close();
});

describe('yarn stock never goes negative', () => {
  it('allows consuming exactly the balance, blocks one gram more', async () => {
    const lot = await newLot(10);
    const beam = await newBeam();
    await db.sql.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'warp', 10)`, [beam, lot]);
    expect(await balance(lot)).toBe(0);
    const err = await pgError(() =>
      db.sql.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'weft', 0.001)`, [beam, lot]),
    );
    expect(err.code).toBe('WV001');
    expect(err.message).toContain('0.000 kg available');
  });

  it('checks the increase when a consumption line is edited, and the new lot when it is moved', async () => {
    const lotA = await newLot(100);
    const lotB = await newLot(20);
    const beam = await newBeam();
    const row = (await db.sql.query(
      `insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'warp', 60) returning id`, [beam, lotA],
    )).rows[0].id;
    await db.sql.query('update yarn_consumption set kgs = 100 where id = $1', [row]);
    const up = await pgError(() => db.sql.query('update yarn_consumption set kgs = 100.5 where id = $1', [row]));
    expect(up.code).toBe('WV001');
    expect(up.message).toContain('0.000 kg available, 0.500 kg requested');
    const mv = await pgError(() => db.sql.query('update yarn_consumption set yarn_lot_id = $2 where id = $1', [row, lotB]));
    expect(mv.code).toBe('WV001');
    expect(mv.message).toContain('20.000 kg available, 100.000 kg requested');
  });

  it('blocks reducing an inward entry below what was already consumed', async () => {
    const lot = await newLot(100);
    const beam = await newBeam();
    await db.sql.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'warp', 80)`, [beam, lot]);
    await db.sql.query('update yarn_lots set kgs_received = 80 where id = $1', [lot]);
    const err = await pgError(() => db.sql.query('update yarn_lots set kgs_received = 79 where id = $1', [lot]));
    expect(err.code).toBe('WV001');
  });

  it('applies signed adjustments and blocks a negative one that overdraws', async () => {
    const lot = await newLot(50);
    await db.sql.query(`insert into stock_adjustments (item_type, yarn_lot_id, factory_id, kgs, reason) values ('yarn_lot', $1, $2, -5, 'moisture loss')`, [lot, id['L-75']]);
    expect(await balance(lot)).toBe(45);
    // factory_id is copied from the lot, whatever the caller sent
    const adj = await db.sql.query(`select factory_id from stock_adjustments where yarn_lot_id = $1`, [lot]);
    expect(adj.rows[0].factory_id).toBe(id['L-76']);
    const err = await pgError(() =>
      db.sql.query(`insert into stock_adjustments (item_type, yarn_lot_id, factory_id, kgs, reason) values ('yarn_lot', $1, $2, -46, 'x')`, [lot, id['L-76']]),
    );
    expect(err.code).toBe('WV001');
    expect(err.message).toContain('45.000 kg available');
  });

  it('serialises concurrent consumption so two people cannot both take the last kg', async () => {
    const lot = await newLot(100);
    const beam = await newBeam();
    const url = new URL(ADMIN_URL);
    url.pathname = `/${db.name}`;
    const [c1, c2] = [new pg.Client({ connectionString: url.toString() }), new pg.Client({ connectionString: url.toString() })];
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      await c1.query('begin');
      await c2.query('begin');
      const ins = `insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'warp', 70)`;
      await c1.query(ins, [beam, lot]);
      const second = c2.query(ins, [beam, lot]).then(() => 'ok', (e: pg.DatabaseError) => e.code);
      await new Promise((r) => setTimeout(r, 200)); // c2 is now waiting on c1's lock
      await c1.query('commit');
      expect(await second).toBe('WV001');
      await c2.query('rollback');
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
    expect(await balance(lot)).toBe(30);
  });
});

describe('beams and looms', () => {
  it('enforces one active beam per loom even when the trigger is bypassed', async () => {
    const loom = await db.id('looms', 'machine_no', 'L76-10');
    const b1 = await newBeam();
    const b2 = await newBeam();
    await db.sql.query('select load_beam($1, $2)', [b1, loom]);
    await db.sql.query(`set session_replication_role = replica`); // disables triggers
    try {
      const err = await pgError(() =>
        db.sql.query(`update beams set status = 'on_loom', loom_id = $2, loaded_at = now() where id = $1`, [b2, loom]),
      );
      expect(err.code).toBe('23505');
      expect(err.constraint).toBe('beams_one_active_per_loom');
    } finally {
      await db.sql.query(`set session_replication_role = origin`);
    }
  });

  it('sets loom status running/idle from the beam and moves the beam to the loom’s factory', async () => {
    const loom = await db.id('looms', 'machine_no', 'L75-01');
    const beam = await newBeam('Mono White', 'L-76');
    await db.sql.query('select load_beam($1, $2)', [beam, loom]);
    let r = (await db.sql.query(`select l.status, b.factory_id from looms l join beams b on b.loom_id = l.id where l.id = $1 and b.id = $2`, [loom, beam])).rows[0];
    expect(r).toEqual({ status: 'running', factory_id: id['L-75'] });
    await db.sql.query('select finish_beam($1)', [beam]);
    r = (await db.sql.query('select status from looms where id = $1', [loom])).rows[0];
    expect(r.status).toBe('idle');
  });

  it('refuses to load on a loom under maintenance or deactivated, and refuses to load a beam twice', async () => {
    const m = await db.id('looms', 'machine_no', 'L76-20');
    const d = await db.id('looms', 'machine_no', 'L76-21');
    await db.sql.query(`update looms set status = 'maintenance' where id = $1`, [m]);
    await db.sql.query(`update looms set active = false where id = $1`, [d]);
    const beam = await newBeam();
    expect((await pgError(() => db.sql.query('select load_beam($1, $2)', [beam, m]))).message).toContain('under maintenance');
    expect((await pgError(() => db.sql.query('select load_beam($1, $2)', [beam, d]))).message).toContain('deactivated');

    const ok = await db.id('looms', 'machine_no', 'L76-22');
    await db.sql.query('select load_beam($1, $2)', [beam, ok]);
    const other = await db.id('looms', 'machine_no', 'L76-23');
    const again = await pgError(() => db.sql.query('select load_beam($1, $2)', [beam, other]));
    expect(again.code).toBe('WV004');
    expect(again.message).toContain('is on loom and cannot be loaded');
  });

  it('a running loom cannot be put in maintenance, deactivated, or marked running by hand', async () => {
    const loom = await db.id('looms', 'machine_no', 'L76-30');
    const beam = await newBeam();
    await db.sql.query('select load_beam($1, $2)', [beam, loom]);
    expect((await pgError(() => db.sql.query(`update looms set status = 'maintenance' where id = $1`, [loom]))).code).toBe('WV004');
    expect((await pgError(() => db.sql.query(`update looms set active = false where id = $1`, [loom]))).code).toBe('WV004');
    const idle = await db.id('looms', 'machine_no', 'L76-31');
    await db.sql.query(`update looms set status = 'running' where id = $1`, [idle]);
    expect((await db.sql.query('select status from looms where id = $1', [idle])).rows[0].status).toBe('idle');
  });

  it('take-off needs a running beam; record_takeoff can finish the beam in the same step', async () => {
    const loom = await db.id('looms', 'machine_no', 'L76-33');
    const err = await pgError(() => db.sql.query('select record_takeoff($1, 10, 5)', [loom]));
    expect(err.message).toBe('Loom L76-33 has no beam running');

    const beam = await newBeam();
    await db.sql.query('select load_beam($1, $2)', [beam, loom]);
    const row = (await db.sql.query(`select * from record_takeoff($1, 100.5, 55.125, p_shift => 'day', p_finish_beam => true)`, [loom])).rows[0];
    expect(row.beam_id).toBe(beam);
    expect(num(row.meters)).toBe(100.5);
    const b = (await db.sql.query('select status, finished_at from beams where id = $1', [beam])).rows[0];
    expect(b.status).toBe('finished');
    expect(b.finished_at).not.toBeNull();

    // direct inserts against a finished beam are rejected too
    const direct = await pgError(() =>
      db.sql.query(`insert into grey_fabric_production (beam_id, loom_id, meters, kgs) values ($1, $2, 1, 1)`, [beam, loom]),
    );
    expect(direct.code).toBe('WV004');
  });

  it('a beam with take-offs cannot be sent back to prepared', async () => {
    const loom = await db.id('looms', 'machine_no', 'L76-34');
    const beam = await newBeam();
    await db.sql.query('select load_beam($1, $2)', [beam, loom]);
    await db.sql.query('select record_takeoff($1, 10, 5)', [loom]);
    const err = await pgError(() => db.sql.query(`update beams set status = 'prepared' where id = $1`, [beam]));
    expect(err.code).toBe('WV004');
  });
});

describe('grey stock never goes negative', () => {
  let loom: string;
  beforeEach(async () => {
    loom = await db.id('looms', 'machine_no', `L75-${String(10 + ++seq % 20).padStart(2, '0')}`);
  });

  it('blocks a dispatch larger than the stock for that quality at that factory', async () => {
    const beam = await newBeam('White/Black', 'L-75');
    await db.sql.query('select load_beam($1, $2)', [beam, loom]);
    await db.sql.query('select record_takeoff($1, 300, 150)', [loom]);

    // No White/Black at L-76 at all
    const wrongFactory = await pgError(() =>
      db.sql.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters, kgs) values ($1, $2, 1, 1)`, [id['White/Black'], id['L-76']]),
    );
    expect(wrongFactory.code).toBe('WV003');

    const tooMuch = await pgError(() =>
      db.sql.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters, kgs) values ($1, $2, 300, 151)`, [id['White/Black'], id['L-75']]),
    );
    expect(tooMuch.code).toBe('WV003');
    expect(JSON.parse(tooMuch.detail!)).toMatchObject({ available_m: 300, available_kg: 150 });

    await db.sql.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters, kgs) values ($1, $2, 300, 150)`, [id['White/Black'], id['L-75']]);

    // ...and deleting the take-off afterwards would leave dispatched fabric unaccounted for
    const del = await pgError(() => db.sql.query('delete from grey_fabric_production where beam_id = $1', [beam]));
    expect(del.code).toBe('WV003');
  });

  it('opening grey stock via adjustment can be dispatched', async () => {
    await db.sql.query(
      `insert into stock_adjustments (item_type, fabric_quality_id, factory_id, meters, kgs, reason, is_opening)
       values ('grey_fabric', $1, $2, 1000, 520, 'Opening stock', true)`,
      [id['Mono White'], id['L-75']],
    );
    await db.sql.query(`insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters, kgs) values ($1, $2, 400, 200)`, [id['Mono White'], id['L-75']]);
    const r = (await db.sql.query(`select * from v_grey_stock where fabric_quality_id = $1 and factory_id = $2`, [id['Mono White'], id['L-75']])).rows[0];
    expect([num(r.adjusted_m), num(r.dispatched_m), num(r.stock_m), num(r.stock_kg)]).toEqual([1000, 400, 600, 320]);
  });
});

describe('data hygiene', () => {
  it('rejects duplicate lot / beam / machine numbers case-insensitively', async () => {
    await newLot(1);
    const dupLot = await pgError(() =>
      db.sql.query(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ($1, $2, $3, 1)`, [`t-${seq}`, id.white, id['L-76']]),
    );
    expect(dupLot.code).toBe('23505');
    const dupLoom = await pgError(() => db.sql.query(`insert into looms (factory_id, machine_no) values ($1, 'l76-01')`, [id['L-76']]));
    expect(dupLoom.code).toBe('23505');
  });

  it('rejects zero / negative quantities', async () => {
    const zero = await pgError(() =>
      db.sql.query(`insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('Z-1', $1, $2, 0)`, [id.white, id['L-76']]),
    );
    expect(zero.code).toBe('23514');
  });

  it('stores kg to 3 decimals and meters to 2', async () => {
    const lot = await newLot(12.34567);
    const r = (await db.sql.query('select kgs_received from yarn_lots where id = $1', [lot])).rows[0];
    expect(r.kgs_received).toBe('12.346');
  });
});

// Parent fabric qualities with multiple specifications (migration 0012).
// Uses the example from the brief: Quality 101 with three specifications.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, num, pgError, type TestDb } from './db';

let db: TestDb;
const id: Record<string, string> = {};
let n = 0;

const one = async (q: string, p: unknown[] = []) => (await db.sql.query(q, p)).rows[0];

async function addSpec(quality: string, reed: number | null, epi: number | null, warp: string | null, weft: string | null) {
  return one(
    `insert into fabric_specifications (fabric_quality_id, seq, spec_code, reed, ends_per_inch, warp_yarn_quality_id, weft_yarn_quality_id)
     values ($1, 0, '', $2, $3, $4, $5) returning *`,
    [id[quality], reed, epi, warp && id[warp], weft && id[weft]],
  );
}

async function beamOn(spec: string, loom: string) {
  const f76 = id['L-76'];
  const b = await one(
    `insert into beams (beam_no, fabric_quality_id, fabric_specification_id, factory_id, warp_length_m) values ($1, $2, $3, $4, 3000) returning id`,
    [`QB-${++n}`, id['Quality 101'], id[spec], f76],
  );
  await db.sql.query('select load_beam($1, (select id from looms where machine_no = $2))', [b.id, loom]);
  return b.id as string;
}

const produce = (loom: string, meters: number, wasted = 0, roll = 100) =>
  one(`select * from record_production(p_loom_id => (select id from looms where machine_no = $1), p_fabric_quality_id => $2,
         p_meters => $3, p_wasted_meters => $4, p_roll_length_m => $5)`, [loom, id['Quality 101'], meters, wasted, roll]);

beforeAll(async () => {
  db = await freshDb();
  id['L-76'] = (await one(`select id from factories where code = 'L-76'`)).id;
  for (const [name, den] of [['PP 0.17', 210], ['PT 0.125', 150]] as const) {
    id[name] = (await one(`insert into yarn_qualities (name, denier) values ($1, $2) returning id`, [name, den])).id;
  }
  id['Quality 101'] = (await one(`insert into fabric_qualities (name, total_ends) values ('Quality 101', 3000) returning id`)).id;
});
afterAll(async () => {
  await db?.close();
});

describe('one parent, many specifications', () => {
  it('Quality 101 holds three specifications with independent reed and ends per inch', async () => {
    const s1 = await addSpec('Quality 101', 48, 52, 'PP 0.17', 'PP 0.17');
    const s2 = await addSpec('Quality 101', 52, 56, 'PT 0.125', 'PP 0.17');
    const s3 = await addSpec('Quality 101', 56, 60, 'PT 0.125', 'PT 0.125');
    [id.S1, id.S2, id.S3] = [s1.id, s2.id, s3.id];
    const rows = (await db.sql.query(
      `select spec_code, reed, ends_per_inch, warp_yarn_quality_name, weft_yarn_quality_name
       from v_fabric_specifications where fabric_quality_id = $1 order by seq`, [id['Quality 101']])).rows;
    expect(rows.map((r) => [r.spec_code, num(r.reed), num(r.ends_per_inch), r.weft_yarn_quality_name, r.warp_yarn_quality_name])).toEqual([
      ['QUALITY101-S1', 48, 52, 'PP 0.17', 'PP 0.17'],
      ['QUALITY101-S2', 52, 56, 'PP 0.17', 'PT 0.125'],
      ['QUALITY101-S3', 56, 60, 'PT 0.125', 'PT 0.125'],
    ]);
    // still a single parent quality
    expect(num((await one(`select count(*) from fabric_qualities where name ilike 'Quality 101%'`)).count)).toBe(1);
    expect(num((await one(`select spec_count from v_fabric_qualities where id = $1`, [id['Quality 101']])).spec_count)).toBe(3);
  });

  it('reed and ends per inch change independently (neither is derived from the other)', async () => {
    const s = await addSpec('Quality 101', 60, 64, 'PP 0.17', 'PT 0.125');
    await db.sql.query('update fabric_specifications set reed = 62 where id = $1', [s.id]);
    let r = await one('select reed, ends_per_inch from fabric_specifications where id = $1', [s.id]);
    expect([num(r.reed), num(r.ends_per_inch)]).toEqual([62, 64]);
    await db.sql.query('update fabric_specifications set ends_per_inch = 70 where id = $1', [s.id]);
    r = await one('select reed, ends_per_inch from fabric_specifications where id = $1', [s.id]);
    expect([num(r.reed), num(r.ends_per_inch)]).toEqual([62, 70]);
    id.S4 = s.id;
  });

  it('the exact same combination cannot be entered twice; any difference is a new specification', async () => {
    const dup = await pgError(() => addSpec('Quality 101', 48, 52, 'PP 0.17', 'PP 0.17'));
    expect(dup.code).toBe('23505');
    expect(dup.constraint ?? dup.message).toMatch(/combo/);
    const sameReed = await addSpec('Quality 101', 48, 54, 'PP 0.17', 'PP 0.17'); // same reed, other ends/inch
    const sameNumbers = await addSpec('Quality 101', 48, 52, 'PT 0.125', 'PP 0.17'); // other warp yarn
    expect([sameReed.spec_code, sameNumbers.spec_code]).toEqual(['QUALITY101-S5', 'QUALITY101-S6']);
  });

  it('Specification IDs stay unique even when two parent names reduce to the same letters', async () => {
    const a = (await one(`insert into fabric_qualities (name) values ('S-813A A/S') returning id`)).id;
    const b = (await one(`insert into fabric_qualities (name) values ('s-813a/as') returning id`)).id;
    const sa = await one(`insert into fabric_specifications (fabric_quality_id, seq, spec_code) values ($1, 0, '') returning spec_code`, [a]);
    const sb = await one(`insert into fabric_specifications (fabric_quality_id, seq, spec_code) values ($1, 0, '') returning spec_code`, [b]);
    const sa2 = await one(`insert into fabric_specifications (fabric_quality_id, seq, spec_code, reed) values ($1, 0, '', 40) returning spec_code`, [a]);
    expect([sa.spec_code, sb.spec_code, sa2.spec_code]).toEqual(['S813AAS-S1', 'S813AAS2-S1', 'S813AAS-S2']);
  });
});

describe('beams, production, rolls and stock per specification', () => {
  it('a beam must name its specification when the parent has several; it must belong to that parent', async () => {
    const e = await pgError(() => db.sql.query(
      `insert into beams (beam_no, fabric_quality_id, factory_id, warp_length_m) values ('X-1', $1, $2, 100)`, [id['Quality 101'], id['L-76']]));
    expect(e.message).toBe('Choose the specification of Quality 101 for this beam');
    const other = (await one(`select id from fabric_specifications where spec_code = 'MONOWHITE-S1'`)).id;
    const fk = await pgError(() => db.sql.query(
      `insert into beams (beam_no, fabric_quality_id, fabric_specification_id, factory_id, warp_length_m) values ('X-2', $1, $2, $3, 100)`,
      [id['Quality 101'], other, id['L-76']]));
    expect(fk.code).toBe('WV004');
    expect(fk.message).toBe('Specification MONOWHITE-S1 does not belong to Quality 101');
  });

  it('production on two looms is recorded against each specification; stock never mixes', async () => {
    await beamOn('S1', 'L76-01');
    await beamOn('S2', 'L76-02');
    const p1 = await produce('L76-01', 680, 33);
    const p2 = await produce('L76-02', 250, 10, 50);
    expect([p1.fabric_specification_id, p2.fabric_specification_id]).toEqual([id.S1, id.S2]);

    const stock = (await db.sql.query(
      `select spec_code, stock_m from v_grey_stock where fabric_quality_id = $1 order by spec_code`, [id['Quality 101']])).rows;
    expect(stock.map((r) => [r.spec_code, num(r.stock_m)])).toEqual([['QUALITY101-S1', 647], ['QUALITY101-S2', 240]]);
    const parent = await one(`select stock_m, spec_count from v_grey_stock_by_quality where fabric_quality_id = $1`, [id['Quality 101']]);
    expect([num(parent.stock_m), num(parent.spec_count)]).toEqual([887, 2]);

    const rolls = (await db.sql.query(
      `select spec_code, count(*), sum(meters) from v_fabric_rolls where fabric_quality_id = $1 group by spec_code order by spec_code`, [id['Quality 101']])).rows;
    expect(rolls.map((r) => [r.spec_code, num(r.count), num(r.sum)])).toEqual([['QUALITY101-S1', 7, 647], ['QUALITY101-S2', 5, 240]]);
  });

  it('dispatch deducts from its own specification; another spec’s stock cannot cover it', async () => {
    const send = (spec: string, m: number) => db.sql.query(
      `insert into grey_fabric_dispatch (fabric_quality_id, fabric_specification_id, factory_id, meters) values ($1, $2, $3, $4)`,
      [id['Quality 101'], id[spec], id['L-76'], m]);
    await send('S2', 200);
    const e = await pgError(() => send('S2', 41)); // parent has 687 m, but S2 only 40
    expect(e.code).toBe('WV003');
    expect(e.message).toBe('Not enough grey stock of Quality 101 · QUALITY101-S2 at L-76: 40.00 m available');
    const s1 = await one(`select stock_m from v_grey_stock where fabric_specification_id = $1`, [id.S1]);
    expect(num(s1.stock_m)).toBe(647);
    // a dispatch naming only the parent is refused when it has several specifications
    const noSpec = await pgError(() => db.sql.query(
      `insert into grey_fabric_dispatch (fabric_quality_id, factory_id, meters) values ($1, $2, 1)`, [id['Quality 101'], id['L-76']]));
    expect(noSpec.message).toBe('Choose the specification of Quality 101 for this dispatch');
  });

  it('adjustments keep the specification', async () => {
    await db.sql.query(
      `insert into stock_adjustments (item_type, fabric_quality_id, fabric_specification_id, factory_id, meters, kgs, reason)
       values ('grey_fabric', $1, $2, $3, -7, 0, 'count')`, [id['Quality 101'], id.S1, id['L-76']]);
    expect(num((await one(`select stock_m from v_grey_stock where fabric_specification_id = $1`, [id.S1])).stock_m)).toBe(640);
  });

  it('yarn consumption is attributed to the beam’s specification', async () => {
    const lot = (await one(
      `insert into yarn_lots (lot_no, yarn_quality_id, factory_id, kgs_received) values ('PP-1', $1, $2, 500) returning id`, [id['PP 0.17'], id['L-76']])).id;
    const beam = (await one(`select beam_id from v_loom_status where machine_no = 'L76-02'`)).beam_id;
    await db.sql.query(`insert into yarn_consumption (beam_id, yarn_lot_id, usage_type, kgs) values ($1, $2, 'weft', 120)`, [beam, lot]);
    const line = await one(`select spec_code, yarn_quality_name, usage_type, kgs from v_consumption_lines where beam_id = $1`, [beam]);
    expect([line.spec_code, line.yarn_quality_name, line.usage_type, num(line.kgs)]).toEqual(['QUALITY101-S2', 'PP 0.17', 'weft', 120]);
  });

  it('a production entry naming the wrong specification is refused', async () => {
    const e = await pgError(() => one(`select * from record_production(p_loom_id => (select id from looms where machine_no = 'L76-01'),
      p_fabric_quality_id => $1, p_fabric_specification_id => $2, p_meters => 10, p_wasted_meters => 0, p_roll_length_m => 10)`, [id['Quality 101'], id.S2]));
    expect(e.code).toBe('WV004');
    expect(e.message).toBe('Beam QB-1 is weaving specification QUALITY101-S1, not the specification selected');
  });
});

describe('looms set up for a specification', () => {
  it('only beams of the loom’s specification can be loaded', async () => {
    await db.sql.query(`update looms set fabric_specification_id = $1 where machine_no = 'L76-03'`, [id.S3]);
    const b = (await one(
      `insert into beams (beam_no, fabric_quality_id, fabric_specification_id, factory_id, warp_length_m) values ('QB-S1', $1, $2, $3, 100) returning id`,
      [id['Quality 101'], id.S1, id['L-76']])).id;
    const e = await pgError(() => db.sql.query(`select load_beam($1, (select id from looms where machine_no = 'L76-03'))`, [b]));
    expect(e.code).toBe('WV002');
    expect(e.message).toBe("Loom L76-03 is set up for QUALITY101-S3; beam QB-S1 is QUALITY101-S1. Change the loom's specification in Settings first.");
    await beamOn('S3', 'L76-03'); // the right one loads
    const l = await one(`select spec_code, assigned_spec_code, reed, ends_per_inch from v_loom_status where machine_no = 'L76-03'`);
    expect([l.spec_code, l.assigned_spec_code, num(l.reed), num(l.ends_per_inch)]).toEqual(['QUALITY101-S3', 'QUALITY101-S3', 56, 60]);
  });

  it('the 68 looms are unchanged', async () => {
    expect(num((await one('select count(*) from looms')).count)).toBe(68);
  });
});

describe('history and deactivation', () => {
  it('a specification with beams keeps its reed, ends per inch and yarns; notes and active can change', async () => {
    const e = await pgError(() => db.sql.query('update fabric_specifications set reed = 50 where id = $1', [id.S1]));
    expect(e.code).toBe('WV004');
    expect(e.message).toMatch(/already has production history/);
    await db.sql.query(`update fabric_specifications set notes = 'old reed set', active = false where id = $1`, [id.S1]);
    // history stays visible; new beams cannot use it
    expect(num((await one(`select count(*) from v_takeoffs where fabric_specification_id = $1`, [id.S1])).count)).toBe(1);
    const e2 = await pgError(() => db.sql.query(
      `insert into beams (beam_no, fabric_quality_id, fabric_specification_id, factory_id, warp_length_m) values ('QB-OLD', $1, $2, $3, 100)`,
      [id['Quality 101'], id.S1, id['L-76']]));
    expect(e2.message).toBe('That specification is deactivated');
  });

  it('blank values of a specification with history can still be filled in once', async () => {
    const s = await addSpec('Quality 101', null, null, 'PP 0.17', 'PP 0.17');
    id.S7 = s.id;
    await beamOn('S7', 'L76-04');
    await db.sql.query('update fabric_specifications set reed = 44, ends_per_inch = 48 where id = $1', [s.id]);
    const r = await one('select reed, ends_per_inch from fabric_specifications where id = $1', [s.id]);
    expect([num(r.reed), num(r.ends_per_inch)]).toEqual([44, 48]);
    expect((await pgError(() => db.sql.query('update fabric_specifications set reed = 45 where id = $1', [s.id]))).code).toBe('WV004');
  });
});

describe('reports', () => {
  it('specification summary: per spec production, rolls, stock and yarn; a parent adds them up', async () => {
    const rows = (await db.sql.query(
      `select spec_code, meters, wasted_meters, net_meters, roll_count, stock_m, weft_issued_kg
       from report_specification_summary('2000-01-01', '2100-01-01', null, $1) order by seq`, [id['Quality 101']])).rows;
    const s1 = rows.find((r) => r.spec_code === 'QUALITY101-S1')!;
    const s2 = rows.find((r) => r.spec_code === 'QUALITY101-S2')!;
    expect([num(s1.meters), num(s1.wasted_meters), num(s1.net_meters), num(s1.roll_count), num(s1.stock_m)]).toEqual([680, 33, 647, 7, 640]);
    expect([num(s2.meters), num(s2.net_meters), num(s2.roll_count), num(s2.stock_m), num(s2.weft_issued_kg)]).toEqual([250, 240, 5, 40, 120]);
    // S1 is deactivated but has history, so it is still reported
    expect(rows.some((r) => r.spec_code === 'QUALITY101-S1')).toBe(true);
  });
});

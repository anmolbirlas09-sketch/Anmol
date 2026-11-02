// Digital beam card (every field optional), loading history, beam replacement
// and time-stamped production with counter readings (migration 0013).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, num, pgError, type TestDb } from './db';

let db: TestDb;
const id: Record<string, string> = {};
const one = async (q: string, p: unknown[] = []) => (await db.sql.query(q, p)).rows[0];
const loom = (no: string) => one(`select id from looms where machine_no = $1`, [no]).then((r) => r.id as string);

/** record_production with named arguments; anything not given stays NULL. */
async function reading(loomNo: string, a: { date?: string; time?: string | null; counter?: number | null; meters?: number | null; reset?: boolean; shift?: string | null; roll?: number | null }) {
  return one(
    `select * from record_production(p_loom_id => $1, p_entry_date => $2::date, p_production_time => $3::time,
       p_counter_reading => $4, p_meters => $5, p_counter_reset => $6, p_shift => $7, p_roll_length_m => $8)`,
    [await loom(loomNo), a.date ?? '2026-10-31', a.time ?? null, a.counter ?? null, a.meters ?? null, a.reset ?? false, a.shift ?? null, a.roll ?? null],
  );
}

beforeAll(async () => {
  db = await freshDb();
  id['L-76'] = (await one(`select id from factories where code = 'L-76'`)).id;
  id['Mono White'] = (await one(`select id from fabric_qualities where name = 'Mono White'`)).id;
  id['PP 0.17'] = (await one(`insert into yarn_qualities (name, denier) values ('PP 0.17', 210) returning id`)).id;
});
afterAll(async () => {
  await db?.close();
});

describe('beam card: every field optional', () => {
  it('a completely empty beam card can be saved; it gets a card number instead of a beam number', async () => {
    const b = await one(`insert into beams default values returning id, card_no, beam_no, fabric_quality_id, factory_id, created_date, warp_length_m`);
    expect([b.beam_no, b.fabric_quality_id, b.factory_id, b.created_date, b.warp_length_m]).toEqual([null, null, null, null, null]);
    const v = await one(`select beam_no, status, fabric_quality_name, spec_code, factory_code from v_beam_summary where beam_id = $1`, [b.id]);
    expect(v).toEqual({ beam_no: `CARD-${b.card_no}`, status: 'prepared', fabric_quality_name: null, spec_code: null, factory_code: null });
    id.empty = b.id;
  });

  it('a partly filled card keeps exactly what was entered (no invented values)', async () => {
    const b = await one(`insert into beams (beam_no, fabric_quality_id) values ('BC-1', $1) returning *`, [id['Mono White']]);
    expect([b.beam_no, b.warp_length_m, b.total_ends, b.reed_space_in, b.gross_weight_kg, b.getting_date]).toEqual(['BC-1', null, null, null, null, null]);
    // Mono White has one specification, so it is filled in
    expect((await one(`select spec_code from v_beam_summary where beam_id = $1`, [b.id])).spec_code).toBe('MONOWHITE-S1');
    id.partial = b.id;
  });

  it('all 20 card fields are stored and shown, and can be completed later', async () => {
    const b = await one(
      `insert into beams (beam_no, created_date, fabric_quality_id, warp_yarn_quality_id, weft_yarn_quality_id, reed, total_ends, reed_space_in, picks_on_loom,
                          warp_length_m, rolling_meter, warp_weight_kg, gross_weight_kg, finished_weight_kg, weft_weight_kg, weave,
                          getting_date, expected_finish_date, factory_id)
       values ('BC-2', '2026-10-25', $1, $2, $2, 48, 4200, 72, 14, 3000, 2950, 210.5, 260, 245.25, 180, 'Plain',
               '2026-10-26', '2026-11-10', $3) returning id`, [id['Mono White'], id['PP 0.17'], id['L-76']]);
    const v = await one(`select *, created_date::text as created_date, getting_date::text as getting_date, expected_finish_date::text as expected_finish_date from v_beam_summary where beam_id = $1`, [b.id]);
    expect([v.beam_no, v.created_date, v.reed, v.total_ends, num(v.reed_space_in), num(v.picks_on_loom), num(v.warp_length_m), num(v.rolling_meter),
      num(v.warp_weight_kg), num(v.gross_weight_kg), num(v.finished_weight_kg), num(v.weft_weight_kg), v.weave, v.getting_date, v.expected_finish_date, v.actual_finish_date])
      .toEqual(['BC-2', '2026-10-25', '48.00', 4200, 72, 14, 3000, 2950, 210.5, 260, 245.25, 180, 'Plain', '2026-10-26', '2026-11-10', null]);
    // edit later: fill in the missing beam number of the empty card
    await db.sql.query(`update beams set beam_no = 'BC-0', weave = 'Twill' where id = $1`, [id.empty]);
    expect((await one(`select beam_no, weave from v_beam_summary where beam_id = $1`, [id.empty]))).toEqual({ beam_no: 'BC-0', weave: 'Twill' });
    id.full = b.id;
  });
});

describe('beam ↔ loom', () => {
  it('a beam without a quality can be loaded; production on it is kept and follows the quality once it is filled in', async () => {
    const l = await loom('L76-20');
    await db.sql.query(`select load_beam($1, $2)`, [id.empty, l]);
    const p = await reading('L76-20', { meters: 120, roll: 50 });
    expect([p.fabric_quality_id, p.fabric_specification_id, num(p.net_meters)]).toEqual([null, null, 120]);
    // stock shows it as "quality not set" rather than losing it
    const unset = await one(`select stock_m from v_grey_stock where fabric_quality_id is null and factory_id = $1`, [id['L-76']]);
    expect(num(unset.stock_m)).toBe(120);
    // the card is completed later: production moves with it
    await db.sql.query(`update beams set fabric_quality_id = $1 where id = $2`, [id['Mono White'], id.empty]);
    const after = await one(`select fabric_quality_id, fabric_specification_id from grey_fabric_production where id = $1`, [p.id]);
    expect(after.fabric_quality_id).toBe(id['Mono White']);
    expect(after.fabric_specification_id).not.toBeNull();
    expect(await one(`select count(*) as n from v_grey_stock where fabric_quality_id is null`)).toEqual({ n: '0' });
    // …but once production exists, a filled-in quality cannot be changed
    const wb = (await one(`select id from fabric_qualities where name = 'White/Black'`)).id;
    const e = await pgError(() => db.sql.query(`update beams set fabric_quality_id = $1, fabric_specification_id = null where id = $2`, [wb, id.empty]));
    expect(e.message).toBe('Beam BC-0 already has production; its specification cannot change');
  });

  it('loading onto a busy loom is refused unless the running beam is replaced (finished or unloaded)', async () => {
    const l = await loom('L76-20');
    const e = await pgError(() => db.sql.query(`select load_beam($1, $2)`, [id.partial, l]));
    expect(e.message).toBe('Loom L76-20 already has beam BC-0 running. Finish or unload it first.');
    // replace: the running beam is unloaded (not finished) and keeps its production
    await db.sql.query(`select load_beam($1, $2, 'unload')`, [id.partial, l]);
    const old = await one(`select status, loom_id from beams where id = $1`, [id.empty]);
    expect(old).toEqual({ status: 'prepared', loom_id: null });
    expect(num((await one(`select grey_meters from v_beam_summary where beam_id = $1`, [id.empty])).grey_meters)).toBe(120);
    // it can go on another loom later and carry on
    await db.sql.query(`select load_beam($1, $2)`, [id.empty, await loom('L76-21')]);
    // replace again with "finish"
    await db.sql.query(`select load_beam($1, $2, 'finish')`, [id.full, l]);
    const fin = await one(`select status, actual_finish_date is not null as dated from beams where id = $1`, [id.partial]);
    expect(fin).toEqual({ status: 'finished', dated: true });
  });

  it('every load, unload and finish is in the beam and loom history', async () => {
    const h = (await db.sql.query(
      `select public.beam_label(b.beam_no, b.card_no) as beam, l.machine_no, e.event
       from beam_loom_events e join beams b on b.id = e.beam_id join looms l on l.id = e.loom_id
       order by e.at, e.seq`)).rows.map((r) => `${r.beam} ${r.event} ${r.machine_no}`);
    expect(h).toEqual([
      'BC-0 loaded L76-20',
      'BC-0 unloaded L76-20',
      'BC-1 loaded L76-20',
      'BC-0 loaded L76-21',
      'BC-1 finished L76-20',
      'BC-2 loaded L76-20',
    ]);
    // one active beam per loom, always
    const busy = await one(`select count(*) as n from beams where status = 'on_loom' and loom_id = $1`, [await loom('L76-20')]);
    expect(num(busy.n)).toBe(1);
  });
});

describe('production with the actual time and counter readings', () => {
  it('first reading with typed metres; later readings work out the metres from the counter', async () => {
    // BC-2 runs on L76-20
    const a = await reading('L76-20', { time: '17:10', counter: 1085, meters: 85 });
    expect([a.shift, a.meters_source, a.previous_reading, num(a.meters)]).toEqual(['day', 'manual', null, 85]);
    const b = await reading('L76-20', { time: '19:25', counter: 1172 });
    expect([b.meters_source, num(b.previous_reading), num(b.meters)]).toEqual(['counter', 1085, 87]);
    const c = await reading('L76-20', { time: '21:40', counter: 1260 });
    expect([c.shift, num(c.previous_reading), num(c.meters)]).toEqual(['night', 1172, 88]);
    const rows = (await db.sql.query(
      `select to_char(production_time, 'HH12:MI AM') as t, counter_reading, meters from v_takeoffs where loom_id = $1 and counter_reading is not null order by reading_at`,
      [await loom('L76-20')])).rows;
    expect(rows.map((r) => [r.t, num(r.counter_reading), num(r.meters)])).toEqual([['05:10 PM', 1085, 85], ['07:25 PM', 1172, 87], ['09:40 PM', 1260, 88]]);
  });

  it('a night-shift reading after midnight follows the evening readings', async () => {
    // dated by the shift's evening (31st) but taken at 01:30 on the 1st
    const d = await reading('L76-20', { time: '01:30', counter: 1400, shift: 'night' });
    expect([num(d.previous_reading), num(d.meters), d.reading_at.toISOString()]).toEqual([1260, 140, '2026-11-01T01:30:00.000Z']);
  });

  it('without a previous reading nothing is invented: metres stay blank unless typed', async () => {
    const l = 'L76-21'; // BC-0 runs here, no counter readings yet
    const first = await reading(l, { time: '10:00', counter: 500 });
    expect([first.meters, first.meters_source, first.previous_reading]).toEqual([null, null, null]);
    const second = await reading(l, { time: '12:00', counter: 560 });
    expect(num(second.meters)).toBe(60);
  });

  it('time is optional; an entry without a time still counts and uses the moment it was entered for order', async () => {
    const p = await reading('L76-20', { meters: 40 });
    expect([p.production_time, p.shift, num(p.meters), p.reading_at !== null]).toEqual([null, null, 40, true]);
  });

  it('counter reset: a lower reading is refused unless marked as a reset; the reset starts a new series', async () => {
    const e = await pgError(() => reading('L76-21', { time: '14:00', counter: 20 }));
    expect(e.message).toBe('Counter reading 20 is lower than the previous reading 560 (31-10-2026 12:00). If the counter was reset or the meter replaced, tick "Counter reset" and enter the metres if known.');
    const r = await reading('L76-21', { time: '14:00', counter: 20, reset: true, meters: 25 });
    expect([num(r.meters), r.meters_source, r.previous_reading, r.counter_reset]).toEqual([25, 'manual', null, true]);
    const next = await reading('L76-21', { time: '16:00', counter: 95 });
    expect([num(next.previous_reading), num(next.meters)]).toEqual([20, 75]);
  });

  it('an entry needs metres or a counter reading; earlier readings are never recalculated', async () => {
    const e = await pgError(() => reading('L76-21', {}));
    expect(e.message).toBe('Enter the production metres or the counter meter reading');
    // a late entry for an earlier time does not change the next entry's metres
    await reading('L76-21', { time: '15:00', counter: 60 });
    const next = await one(`select meters from grey_fabric_production where loom_id = $1 and counter_reading = 95`, [await loom('L76-21')]);
    expect(num(next.meters)).toBe(75);
  });

  it('loom report: time window and shift filters; the loom shows its last reading', async () => {
    const l = await loom('L76-20');
    const all = await one(`select sum(meters) as m from report_loom_production('2026-10-31', '2026-10-31', p_loom_id => $1)`, [l]);
    const evening = await one(`select sum(meters) as m from report_loom_production('2026-10-31', '2026-10-31', p_loom_id => $1,
                                 p_time_from => '17:00', p_time_to => '20:00')`, [l]);
    const night = await one(`select sum(meters) as m from report_loom_production('2026-10-31', '2026-10-31', p_loom_id => $1, p_shift => 'night')`, [l]);
    expect([num(evening.m), num(night.m)]).toEqual([85 + 87, 88 + 140]);
    expect(num(all.m)).toBe(85 + 87 + 88 + 140 + 40 + 120); // + BC-0's 120 m from earlier today
    const ls = await one(`select last_counter_reading, last_reading_time from v_loom_status where loom_id = $1`, [l]);
    expect([num(ls.last_counter_reading), ls.last_reading_time]).toEqual([1400, '01:30:00']);
  });
});

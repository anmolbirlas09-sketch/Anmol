import { fetchAll } from '../data/paging';
import type { Db } from '../data/client';
import { L } from '../labels';
import { fmtTime } from '../format';
import type { BeamSummary, FabricRoll, Takeoff } from '../types';
import { subtitleFor, totalsFor, weightedPct, type Column, type ReportKind, type ReportParams, type ReportTable, type Row } from './model';

const C = L.reports.col;

async function rpcAll(db: Db, fn: string, args: Record<string, unknown>, order: string): Promise<Row[]> {
  return fetchAll<Row>((from, to) => db.rpc(fn, args).order(order).range(from, to));
}

function table(kind: ReportKind, p: ReportParams, columns: Column[], rows: Row[], flagged?: boolean[]): ReportTable {
  return { kind, title: L.reports.kinds[kind].title, subtitle: subtitleFor(p), columns, rows, totals: totalsFor(columns, rows), flagged };
}

/** Metre-first production columns (shared by production, loom and beam reports). */
const metreColumns: Column[] = [
  { key: 'meters', label: C.totalM, kind: 'm', total: true },
  { key: 'wasted_meters', label: C.wastedM, kind: 'm', total: true },
  { key: 'net_meters', label: C.netM, kind: 'm', total: true },
  { key: 'wastage_pct', label: C.wastageMPct, kind: 'pct', total: weightedPct('wasted_meters', 'meters') },
];

/** Weights: blank when not recorded; estimated and actual kept apart. */
const kgColumns: Column[] = [
  { key: 'estimated_kg', label: C.estKg, kind: 'kg', total: true },
  { key: 'kgs', label: C.weighedKg, kind: 'kg', total: true },
  { key: 'warp_kg', label: C.warpKg, kind: 'kg', total: true },
  { key: 'weft_kg', label: C.weftKg, kind: 'kg', total: true },
  { key: 'total_yarn_kg', label: C.totalYarnKg, kind: 'kg', total: true },
  { key: 'waste_kg', label: C.wasteKgActual, kind: 'kg', total: true },
  { key: 'waste_kg_estimated', label: C.wasteKgEst, kind: 'kg', total: true },
];

const yarnCols: Column[] = [
  { key: 'opening_kg', label: C.opening, kind: 'kg', total: true },
  { key: 'inward_kg', label: C.inward, kind: 'kg', total: true },
  { key: 'warp_kg', label: C.warp, kind: 'kg', total: true },
  { key: 'weft_kg', label: C.weft, kind: 'kg', total: true },
  { key: 'adjusted_kg', label: C.adjusted, kind: 'kg', total: true },
  { key: 'closing_kg', label: C.closing, kind: 'kg', total: true },
];

/** Production entries in the period with every filter applied, in the order the readings were taken. */
async function fetchTakeoffs(db: Db, p: ReportParams): Promise<Takeoff[]> {
  return fetchAll<Takeoff>((from, to) => {
    let q = db.from('v_takeoffs').select('*').gte('entry_date', p.from).lte('entry_date', p.to);
    if (p.factoryId) q = q.eq('factory_id', p.factoryId);
    if (p.loomId) q = q.eq('loom_id', p.loomId);
    if (p.fabricQualityId) q = q.eq('fabric_quality_id', p.fabricQualityId);
    if (p.fabricSpecificationId) q = q.eq('fabric_specification_id', p.fabricSpecificationId);
    if (p.beamNo) q = q.ilike('beam_no', p.beamNo);
    if (p.timeFrom) q = q.gte('production_time', p.timeFrom);
    if (p.timeTo) q = q.lte('production_time', `${p.timeTo}:59`);
    if (p.shift) q = q.eq('shift', p.shift);
    return q.order('reading_at').order('created_at').range(from, to);
  });
}

const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

export async function buildReport(db: Db, kind: ReportKind, p: ReportParams): Promise<ReportTable> {
  const args = { p_from: p.from, p_to: p.to, p_factory_id: p.factoryId ?? null };

  switch (kind) {
    case 'yarn-quality': {
      const rows = await rpcAll(db, 'report_yarn_by_quality', args, 'yarn_quality_name');
      return table(kind, p, [{ key: 'yarn_quality_name', label: C.quality, kind: 'text' }, ...yarnCols], rows);
    }
    case 'yarn-lot': {
      const rows = await rpcAll(db, 'report_yarn_by_lot', args, 'lot_no');
      rows.sort((a, b) => String(a.inward_date).localeCompare(String(b.inward_date)) || String(a.lot_no).localeCompare(String(b.lot_no)));
      return table(kind, p, [
        { key: 'lot_no', label: C.lot, kind: 'text' },
        { key: 'inward_date', label: C.inwardDate, kind: 'date' },
        { key: 'yarn_quality_name', label: C.quality, kind: 'text' },
        { key: 'factory_code', label: C.factory, kind: 'text' },
        ...yarnCols,
      ], rows);
    }
    case 'grey-summary': {
      const rows = await rpcAll(db, 'report_grey_summary', args, 'fabric_quality_name');
      return table(kind, p, [
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'spec_code', label: C.spec, kind: 'text' },
        { key: 'factory_code', label: C.factory, kind: 'text' },
        { key: 'opening_m', label: C.openingM, kind: 'm', total: true },
        { key: 'opening_kg', label: C.openingKg, kind: 'kg', total: true },
        { key: 'produced_m', label: C.producedM, kind: 'm', total: true },
        { key: 'produced_kg', label: C.producedKg, kind: 'kg', total: true },
        { key: 'dispatched_m', label: C.dispatchedM, kind: 'm', total: true },
        { key: 'dispatched_kg', label: C.dispatchedKg, kind: 'kg', total: true },
        { key: 'adjusted_m', label: C.adjustedM, kind: 'm', total: true },
        { key: 'adjusted_kg', label: C.adjustedKg, kind: 'kg', total: true },
        { key: 'closing_m', label: C.closingM, kind: 'm', total: true },
        { key: 'closing_kg', label: C.closingKg, kind: 'kg', total: true },
      ], rows);
    }
    case 'loom-production': {
      const rows = await rpcAll(db, 'report_loom_production', {
        ...args, p_period: p.period, p_loom_id: p.loomId ?? null, p_fabric_quality_id: p.fabricQualityId ?? null, p_beam_no: p.beamNo ?? null,
        p_fabric_specification_id: p.fabricSpecificationId ?? null,
        p_time_from: p.timeFrom ?? null, p_time_to: p.timeTo ? `${p.timeTo}:59` : null, p_shift: p.shift ?? null,
      }, 'period');
      return table(kind, p, [
        { key: 'period', label: C.period, kind: p.period === 'month' ? 'month' : 'date' },
        { key: 'factory_code', label: C.factory, kind: 'text' },
        { key: 'machine_no', label: C.loom, kind: 'text' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'spec_code', label: C.spec, kind: 'text' },
        { key: 'takeoff_count', label: C.takeoffs, kind: 'int', total: true },
        ...metreColumns,
        ...kgColumns,
      ], rows.sort((a, b) => String(a.period).localeCompare(String(b.period)) || String(b.factory_code).localeCompare(String(a.factory_code)) || String(a.machine_no).localeCompare(String(b.machine_no))));
    }
    case 'specifications': {
      const specRows = await rpcAll(db, 'report_specification_summary', {
        p_from: p.from, p_to: p.to, p_factory_id: p.factoryId ?? null,
        p_fabric_quality_id: p.fabricQualityId ?? null, p_fabric_specification_id: p.fabricSpecificationId ?? null,
      }, 'fabric_quality_name');
      const columns: Column[] = [
        { key: 'level', label: C.level, kind: 'text' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'spec_code', label: C.spec, kind: 'text' },
        { key: 'reed', label: C.reed, kind: 'ratio' },
        { key: 'ends_per_inch', label: C.epi, kind: 'ratio' },
        { key: 'weft_yarn_quality_name', label: C.weftYarn, kind: 'text' },
        { key: 'warp_yarn_quality_name', label: C.warpYarn, kind: 'text' },
        { key: 'takeoff_count', label: C.takeoffs, kind: 'int', total: true },
        ...metreColumns,
        { key: 'roll_count', label: C.rolls, kind: 'int', total: true },
        { key: 'stock_m', label: C.stockM, kind: 'm', total: true },
        { key: 'stock_kg', label: C.stockKg, kind: 'kg', total: true },
        { key: 'warp_issued_kg', label: C.warpIssued, kind: 'kg', total: true },
        { key: 'weft_issued_kg', label: C.weftIssued, kind: 'kg', total: true },
        { key: 'prod_warp_kg', label: C.warpKg, kind: 'kg', total: true },
        { key: 'prod_weft_kg', label: C.weftKg, kind: 'kg', total: true },
        { key: 'estimated_kg', label: C.estKg, kind: 'kg', total: true },
        { key: 'kgs', label: C.weighedKg, kind: 'kg', total: true },
        { key: 'waste_kg', label: C.wasteKgActual, kind: 'kg', total: true },
        { key: 'waste_kg_estimated', label: C.wasteKgEst, kind: 'kg', total: true },
      ];
      const sumKeys = columns.filter((c) => c.total === true).map((c) => c.key);
      const out: Row[] = [];
      const indented: boolean[] = [];
      const parents: Row[] = [];
      const byParent = new Map<string, Row[]>();
      for (const r of specRows) byParent.set(String(r.fabric_quality_id), [...(byParent.get(String(r.fabric_quality_id)) ?? []), r]);
      for (const list of byParent.values()) {
        // Parent row = its specifications added up (only what was recorded; blank stays blank).
        const parent: Row = { level: C.parentLevel, fabric_quality_name: list[0].fabric_quality_name, spec_code: L.spec.count(list.length) };
        for (const k of sumKeys) {
          const known = list.map((r) => r[k]).filter((x) => x !== null && x !== undefined);
          parent[k] = known.length ? Math.round(known.reduce<number>((a, x) => a + Number(x), 0) * 1000) / 1000 : null;
        }
        parent.wastage_pct = weightedPct('wasted_meters', 'meters')([parent]);
        parents.push(parent);
        out.push(parent);
        indented.push(false);
        if (p.showSpecs !== false) {
          for (const r of list) {
            out.push({ ...r, level: C.specLevel, wastage_pct: weightedPct('wasted_meters', 'meters')([r]) });
            indented.push(true);
          }
        }
      }
      // Totals from the parent rows only, so specifications are not counted twice.
      return { ...table(kind, p, columns, out), totals: totalsFor(columns, parents), indented };
    }
    case 'production': {
      const entries = await fetchTakeoffs(db, p);
      const rows: Row[] = entries.map((t) => ({
        entry_date: t.entry_date, production_time: t.production_time ? fmtTime(t.production_time) : null,
        shift: t.shift ? (L.takeoff.shiftShort[t.shift] ?? t.shift) : null, machine_no: t.machine_no, beam_no: t.beam_no,
        counter_reading: t.counter_reading, previous_reading: t.previous_reading,
        meters_source: t.meters_source === 'counter' ? L.production.sourceCounter : t.meters_source === 'manual' ? L.production.sourceManual : null,
        fabric_quality_name: t.fabric_quality_name, spec_code: t.spec_code, reed: t.reed, ends_per_inch: t.ends_per_inch,
        warp_yarn: t.warp_yarn_quality_name, weft_yarn: t.weft_yarn_quality_name, meters: t.meters, wasted_meters: t.wasted_meters, net_meters: t.net_meters,
        wastage_pct: t.wastage_pct, roll_count: t.roll_count, roll_length_m: t.roll_length_m, gsm: t.gsm, width_m: t.width_m,
        estimated_kg: t.estimated_kg, kgs: t.kgs, warp_kg: t.warp_kg, weft_kg: t.weft_kg, total_yarn_kg: t.total_yarn_kg,
        waste_kg: t.waste_kg, waste_kg_estimated: t.waste_kg_estimated, weight_wastage_pct: t.weight_wastage_pct, waste_pct_entered: t.waste_pct_entered,
      }));
      return table(kind, p, [
        { key: 'entry_date', label: C.date, kind: 'date' },
        { key: 'production_time', label: C.time, kind: 'text' },
        { key: 'shift', label: C.shift, kind: 'text' },
        { key: 'machine_no', label: C.loom, kind: 'text' },
        { key: 'beam_no', label: C.beam, kind: 'text' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'spec_code', label: C.spec, kind: 'text' },
        { key: 'reed', label: C.reed, kind: 'ratio' },
        { key: 'ends_per_inch', label: C.epi, kind: 'ratio' },
        { key: 'weft_yarn', label: C.weftYarn, kind: 'text' },
        { key: 'warp_yarn', label: C.warpYarn, kind: 'text' },
        { key: 'counter_reading', label: C.counter, kind: 'm' },
        { key: 'previous_reading', label: C.previous, kind: 'm' },
        { key: 'meters_source', label: C.source, kind: 'text' },
        ...metreColumns,
        { key: 'roll_count', label: C.rolls, kind: 'int', total: true },
        { key: 'roll_length_m', label: C.rollLength, kind: 'm' },
        { key: 'gsm', label: C.gsm, kind: 'ratio' },
        { key: 'width_m', label: C.width, kind: 'ratio' },
        ...kgColumns,
        { key: 'weight_wastage_pct', label: C.wastePctActual, kind: 'pct' },
        { key: 'waste_pct_entered', label: C.wastePctEntered, kind: 'pct' },
      ], rows);
    }
    case 'daily': {
      const group = p.group ?? 'loom';
      const entries = await fetchTakeoffs(db, p);
      const keyOf = (t: Takeoff): [string, string] => {
        switch (group) {
          case 'quality': return [t.fabric_quality_id ?? '', t.fabric_quality_name ?? C.notSet];
          case 'spec': return [t.fabric_specification_id ?? `q:${t.fabric_quality_id ?? ''}`, `${t.fabric_quality_name ?? C.notSet} · ${t.spec_code ?? C.notSet}`];
          case 'beam': return [t.beam_id, `${t.beam_no} · ${t.fabric_quality_name ?? C.notSet}`];
          default: return [t.loom_id, t.machine_no];
        }
      };
      const byKey = new Map<string, Row>();
      const sortKey = new Map<string, { d: string; f: string; o: number; l: string }>();
      // One day for all looms: list every loom, also those that produced nothing.
      if (group === 'loom' && p.from === p.to) {
        let lq = db.from('v_loom_status').select('loom_id, machine_no, factory_code, sort_order').eq('active', true);
        if (p.factoryId) lq = lq.eq('factory_id', p.factoryId);
        if (p.loomId) lq = lq.eq('loom_id', p.loomId);
        const all = (await lq).data as { loom_id: string; machine_no: string; factory_code: string; sort_order: number }[] | null;
        for (const l of all ?? []) {
          const k = `${p.from}|${l.loom_id}`;
          byKey.set(k, { entry_date: p.from, label: l.machine_no, factory_code: l.factory_code, takeoff_count: 0, meters: null, wasted_meters: null, net_meters: null, roll_count: 0 });
          sortKey.set(k, { d: p.from, f: l.factory_code, o: l.sort_order, l: l.machine_no });
        }
      }
      for (const t of entries) {
        const [id, label] = keyOf(t);
        const k = `${t.entry_date}|${id}`;
        const r = byKey.get(k) ?? { entry_date: t.entry_date, label, factory_code: t.factory_code, takeoff_count: 0, meters: null, wasted_meters: null, net_meters: null, roll_count: 0 };
        r.takeoff_count = Number(r.takeoff_count) + 1;
        r.meters = add(r.meters as number | null, t.meters);
        if (t.meters !== null) r.wasted_meters = add(r.wasted_meters as number | null, t.wasted_meters);
        r.net_meters = add(r.net_meters as number | null, t.net_meters);
        r.roll_count = Number(r.roll_count) + Number(t.roll_count);
        byKey.set(k, r);
        if (!sortKey.has(k)) sortKey.set(k, { d: t.entry_date, f: group === 'loom' ? t.factory_code : '', o: 0, l: label });
      }
      const rows = [...byKey.entries()]
        .sort(([a], [b]) => {
          const x = sortKey.get(a)!, y = sortKey.get(b)!;
          // date, then factory (L-76 before L-75, as everywhere), then loom order / name
          return x.d.localeCompare(y.d) || y.f.localeCompare(x.f) || x.o - y.o || x.l.localeCompare(y.l, 'en', { numeric: true });
        })
        .map(([, r]) => ({
          ...r, meters: r2(r.meters as number | null), wasted_meters: r2(r.wasted_meters as number | null), net_meters: r2(r.net_meters as number | null),
          wastage_pct: weightedPct('wasted_meters', 'meters')([r]),
        }));
      const groupLabel = { loom: C.loom, quality: C.fabricQuality, spec: C.spec, beam: C.beam }[group];
      return table(kind, p, [
        { key: 'entry_date', label: C.date, kind: 'date' },
        { key: 'label', label: groupLabel, kind: 'text' },
        ...(group === 'loom' ? [{ key: 'factory_code', label: C.factory, kind: 'text' } as Column] : []),
        { key: 'takeoff_count', label: C.takeoffs, kind: 'int', total: true },
        ...metreColumns,
        { key: 'roll_count', label: C.rolls, kind: 'int', total: true },
      ], rows);
    }
    case 'shift': {
      const entries = await fetchTakeoffs(db, p);
      const byLoom = new Map<string, Row>();
      for (const t of entries) {
        const r = byLoom.get(t.loom_id) ?? {
          machine_no: t.machine_no, factory_code: t.factory_code, day_m: null, night_m: null, noshift_m: null,
          day_entries: 0, night_entries: 0, takeoff_count: 0, meters: null, wasted_meters: null, net_meters: null,
        };
        const col = t.shift === 'day' ? 'day_m' : t.shift === 'night' ? 'night_m' : 'noshift_m';
        r[col] = r2(add(r[col] as number | null, t.meters));
        if (t.shift === 'day') r.day_entries = Number(r.day_entries) + 1;
        if (t.shift === 'night') r.night_entries = Number(r.night_entries) + 1;
        r.takeoff_count = Number(r.takeoff_count) + 1;
        r.meters = r2(add(r.meters as number | null, t.meters));
        if (t.meters !== null) r.wasted_meters = r2(add(r.wasted_meters as number | null, t.wasted_meters));
        r.net_meters = r2(add(r.net_meters as number | null, t.net_meters));
        byLoom.set(t.loom_id, r);
      }
      const rows = [...byLoom.values()]
        .sort((a, b) => String(b.factory_code).localeCompare(String(a.factory_code)) || String(a.machine_no).localeCompare(String(b.machine_no), 'en', { numeric: true }))
        .map((r) => ({
          ...r, wastage_pct: weightedPct('wasted_meters', 'meters')([r]),
          avg_m: r.meters !== null && Number(r.takeoff_count) ? r2(Number(r.meters) / Number(r.takeoff_count)) : null,
        }));
      return table(kind, p, [
        { key: 'machine_no', label: C.loom, kind: 'text' },
        { key: 'factory_code', label: C.factory, kind: 'text' },
        { key: 'day_m', label: C.dayM, kind: 'm', total: true },
        { key: 'night_m', label: C.nightM, kind: 'm', total: true },
        { key: 'noshift_m', label: C.noShiftM, kind: 'm', total: true },
        { key: 'meters', label: C.totalM, kind: 'm', total: true },
        { key: 'day_entries', label: C.dayEntries, kind: 'int', total: true },
        { key: 'night_entries', label: C.nightEntries, kind: 'int', total: true },
        { key: 'takeoff_count', label: C.takeoffs, kind: 'int', total: true },
        { key: 'avg_m', label: C.avgPerEntry, kind: 'm' },
        { key: 'wasted_meters', label: C.wastedM, kind: 'm', total: true },
        { key: 'net_meters', label: C.netM, kind: 'm', total: true },
        { key: 'wastage_pct', label: C.wastageMPct, kind: 'pct', total: weightedPct('wasted_meters', 'meters') },
      ], rows);
    }
    case 'rolls': {
      const rolls = await fetchAll<FabricRoll>((from, to) => {
        let q = db.from('v_fabric_rolls').select('*').gte('entry_date', p.from).lte('entry_date', p.to);
        if (p.factoryId) q = q.eq('factory_id', p.factoryId);
        if (p.loomId) q = q.eq('loom_id', p.loomId);
        if (p.fabricQualityId) q = q.eq('fabric_quality_id', p.fabricQualityId);
        if (p.fabricSpecificationId) q = q.eq('fabric_specification_id', p.fabricSpecificationId);
        if (p.beamNo) q = q.ilike('beam_no', p.beamNo);
        return q.order('entry_date').order('roll_no').range(from, to);
      });
      const rows: Row[] = rolls.map((r) => ({
        roll_no: r.roll_no, entry_date: r.entry_date, machine_no: r.machine_no, beam_no: r.beam_no,
        fabric_quality_name: r.fabric_quality_name, spec_code: r.spec_code, factory_code: r.factory_code, meters: r.meters,
      }));
      return table(kind, p, [
        { key: 'roll_no', label: C.rollNo, kind: 'text' },
        { key: 'entry_date', label: C.date, kind: 'date' },
        { key: 'machine_no', label: C.loom, kind: 'text' },
        { key: 'beam_no', label: C.beam, kind: 'text' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'spec_code', label: C.spec, kind: 'text' },
        { key: 'factory_code', label: C.factory, kind: 'text' },
        { key: 'meters', label: C.meters, kind: 'm', total: true },
      ], rows);
    }
    case 'beam-register':
    case 'variance': {
      const beams = await fetchAll<BeamSummary>((from, to) => {
        let q = db.from('v_beam_summary').select('*').gte('register_date', p.from).lte('register_date', p.to);
        if (p.factoryId) q = q.eq('factory_id', p.factoryId);
        if (p.loomId) q = q.eq('loom_id', p.loomId);
        if (p.fabricQualityId) q = q.eq('fabric_quality_id', p.fabricQualityId);
        if (p.fabricSpecificationId) q = q.eq('fabric_specification_id', p.fabricSpecificationId);
        if (p.beamNo) q = q.ilike('beam_no', p.beamNo);
        return q.order('register_date').order('card_no').range(from, to);
      });
      if (kind === 'beam-register') {
        const rows: Row[] = beams.map((b) => ({
          beam_no: b.beam_no, created_date: b.register_date, factory_code: b.factory_code, fabric_quality_name: b.fabric_quality_name, spec_code: b.spec_code,
          machine_no: b.machine_no, status: L.beam.statuses[b.status],
          warp_issued: b.warp_kg, weft_issued: b.weft_kg, yarn_issued: b.total_yarn_kg,
          meters: b.takeoff_count ? b.grey_meters : null, wasted_meters: b.takeoff_count ? b.wasted_meters : null,
          net_meters: b.takeoff_count ? b.net_meters : null, wastage_pct: b.wastage_pct, roll_count: b.roll_count,
          estimated_kg: b.estimated_kg, kgs: b.grey_kg, warp_kg: b.prod_warp_kg, weft_kg: b.prod_weft_kg, total_yarn_kg: b.prod_total_yarn_kg,
          waste_kg: b.waste_kg_actual, waste_kg_estimated: b.waste_kg_estimated, weight_wastage_pct: b.weight_wastage_pct_actual,
          meters_per_kg: b.meters_per_kg,
        }));
        return table(kind, p, [
          { key: 'beam_no', label: C.beam, kind: 'text' },
          { key: 'created_date', label: C.date, kind: 'date' },
          { key: 'factory_code', label: C.factory, kind: 'text' },
          { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
          { key: 'spec_code', label: C.spec, kind: 'text' },
          { key: 'machine_no', label: C.loom, kind: 'text' },
          { key: 'status', label: C.status, kind: 'text' },
          { key: 'warp_issued', label: C.warpIssued, kind: 'kg', total: true },
          { key: 'weft_issued', label: C.weftIssued, kind: 'kg', total: true },
          { key: 'yarn_issued', label: C.yarnIssued, kind: 'kg', total: true },
          ...metreColumns,
          { key: 'roll_count', label: C.rolls, kind: 'int', total: true },
          ...kgColumns,
          { key: 'weight_wastage_pct', label: C.wastePctActual, kind: 'pct' },
          { key: 'meters_per_kg', label: C.mPerKg, kind: 'ratio' },
        ], rows);
      }
      const rows: Row[] = beams.map((b) => ({
        beam_no: b.beam_no, created_date: b.created_date, fabric_quality_name: b.fabric_quality_name, spec_code: b.spec_code,
        planned_warp_kg: b.planned_warp_kg, warp_kg: b.warp_kg, warp_variance_pct: b.warp_variance_pct,
        planned_weft_kg: b.planned_weft_kg, weft_kg: b.weft_kg, weft_variance_pct: b.weft_variance_pct,
        flag: b.warp_variance_flag || b.weft_variance_flag,
      }));
      return table(kind, p, [
        { key: 'beam_no', label: C.beam, kind: 'text' },
        { key: 'created_date', label: C.date, kind: 'date' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'spec_code', label: C.spec, kind: 'text' },
        { key: 'planned_warp_kg', label: C.warpPlanned, kind: 'kg', total: true },
        { key: 'warp_kg', label: C.warpActual, kind: 'kg', total: true },
        { key: 'warp_variance_pct', label: C.warpVar, kind: 'pct' },
        { key: 'planned_weft_kg', label: C.weftPlanned, kind: 'kg', total: true },
        { key: 'weft_kg', label: C.weftActual, kind: 'kg', total: true },
        { key: 'weft_variance_pct', label: C.weftVar, kind: 'pct' },
        { key: 'flag', label: C.flag, kind: 'flag' },
      ], rows, rows.map((r) => Boolean(r.flag)));
    }
  }
}

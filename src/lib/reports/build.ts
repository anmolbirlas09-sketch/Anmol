import { fetchAll } from '../data/paging';
import type { Db } from '../data/client';
import { L } from '../labels';
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
      }, 'period');
      return table(kind, p, [
        { key: 'period', label: C.period, kind: p.period === 'month' ? 'month' : 'date' },
        { key: 'factory_code', label: C.factory, kind: 'text' },
        { key: 'machine_no', label: C.loom, kind: 'text' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'takeoff_count', label: C.takeoffs, kind: 'int', total: true },
        ...metreColumns,
        ...kgColumns,
      ], rows.sort((a, b) => String(a.period).localeCompare(String(b.period)) || String(b.factory_code).localeCompare(String(a.factory_code)) || String(a.machine_no).localeCompare(String(b.machine_no))));
    }
    case 'production': {
      const entries = await fetchAll<Takeoff>((from, to) => {
        let q = db.from('v_takeoffs').select('*').gte('entry_date', p.from).lte('entry_date', p.to);
        if (p.factoryId) q = q.eq('factory_id', p.factoryId);
        if (p.loomId) q = q.eq('loom_id', p.loomId);
        if (p.fabricQualityId) q = q.eq('fabric_quality_id', p.fabricQualityId);
        if (p.beamNo) q = q.ilike('beam_no', p.beamNo);
        return q.order('entry_date').order('created_at').range(from, to);
      });
      const rows: Row[] = entries.map((t) => ({
        entry_date: t.entry_date, shift: t.shift ? (L.takeoff.shifts[t.shift] ?? t.shift) : null, machine_no: t.machine_no, beam_no: t.beam_no,
        fabric_quality_name: t.fabric_quality_name, meters: t.meters, wasted_meters: t.wasted_meters, net_meters: t.net_meters,
        wastage_pct: t.wastage_pct, roll_count: t.roll_count, roll_length_m: t.roll_length_m, gsm: t.gsm, width_m: t.width_m,
        estimated_kg: t.estimated_kg, kgs: t.kgs, warp_kg: t.warp_kg, weft_kg: t.weft_kg, total_yarn_kg: t.total_yarn_kg,
        waste_kg: t.waste_kg, waste_kg_estimated: t.waste_kg_estimated, weight_wastage_pct: t.weight_wastage_pct, waste_pct_entered: t.waste_pct_entered,
      }));
      return table(kind, p, [
        { key: 'entry_date', label: C.date, kind: 'date' },
        { key: 'shift', label: C.shift, kind: 'text' },
        { key: 'machine_no', label: C.loom, kind: 'text' },
        { key: 'beam_no', label: C.beam, kind: 'text' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
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
    case 'rolls': {
      const rolls = await fetchAll<FabricRoll>((from, to) => {
        let q = db.from('v_fabric_rolls').select('*').gte('entry_date', p.from).lte('entry_date', p.to);
        if (p.factoryId) q = q.eq('factory_id', p.factoryId);
        if (p.loomId) q = q.eq('loom_id', p.loomId);
        if (p.fabricQualityId) q = q.eq('fabric_quality_id', p.fabricQualityId);
        if (p.beamNo) q = q.ilike('beam_no', p.beamNo);
        return q.order('entry_date').order('roll_no').range(from, to);
      });
      const rows: Row[] = rolls.map((r) => ({
        roll_no: r.roll_no, entry_date: r.entry_date, machine_no: r.machine_no, beam_no: r.beam_no,
        fabric_quality_name: r.fabric_quality_name, factory_code: r.factory_code, meters: r.meters,
      }));
      return table(kind, p, [
        { key: 'roll_no', label: C.rollNo, kind: 'text' },
        { key: 'entry_date', label: C.date, kind: 'date' },
        { key: 'machine_no', label: C.loom, kind: 'text' },
        { key: 'beam_no', label: C.beam, kind: 'text' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'factory_code', label: C.factory, kind: 'text' },
        { key: 'meters', label: C.meters, kind: 'm', total: true },
      ], rows);
    }
    case 'beam-register':
    case 'variance': {
      const beams = await fetchAll<BeamSummary>((from, to) => {
        let q = db.from('v_beam_summary').select('*').gte('created_date', p.from).lte('created_date', p.to);
        if (p.factoryId) q = q.eq('factory_id', p.factoryId);
        if (p.loomId) q = q.eq('loom_id', p.loomId);
        if (p.fabricQualityId) q = q.eq('fabric_quality_id', p.fabricQualityId);
        if (p.beamNo) q = q.ilike('beam_no', p.beamNo);
        return q.order('created_date').order('beam_no').range(from, to);
      });
      if (kind === 'beam-register') {
        const rows: Row[] = beams.map((b) => ({
          beam_no: b.beam_no, created_date: b.created_date, factory_code: b.factory_code, fabric_quality_name: b.fabric_quality_name,
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
        beam_no: b.beam_no, created_date: b.created_date, fabric_quality_name: b.fabric_quality_name,
        planned_warp_kg: b.planned_warp_kg, warp_kg: b.warp_kg, warp_variance_pct: b.warp_variance_pct,
        planned_weft_kg: b.planned_weft_kg, weft_kg: b.weft_kg, weft_variance_pct: b.weft_variance_pct,
        flag: b.warp_variance_flag || b.weft_variance_flag,
      }));
      return table(kind, p, [
        { key: 'beam_no', label: C.beam, kind: 'text' },
        { key: 'created_date', label: C.date, kind: 'date' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
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

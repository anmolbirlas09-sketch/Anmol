import { fetchAll } from '../data/paging';
import type { Db } from '../data/client';
import { L } from '../labels';
import type { BeamSummary } from '../types';
import { subtitleFor, totalsFor, type Column, type ReportKind, type ReportParams, type ReportTable, type Row } from './model';

const C = L.reports.col;

async function rpcAll(db: Db, fn: string, args: Record<string, unknown>, order: string): Promise<Row[]> {
  return fetchAll<Row>((from, to) => db.rpc(fn, args).order(order).range(from, to));
}

function table(kind: ReportKind, p: ReportParams, columns: Column[], rows: Row[], flagged?: boolean[]): ReportTable {
  return { kind, title: L.reports.kinds[kind].title, subtitle: subtitleFor(p), columns, rows, totals: totalsFor(columns, rows), flagged };
}

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
      const rows = await rpcAll(db, 'report_loom_production', { ...args, p_period: p.period }, 'period');
      return table(kind, p, [
        { key: 'period', label: C.period, kind: p.period === 'month' ? 'month' : 'date' },
        { key: 'factory_code', label: C.factory, kind: 'text' },
        { key: 'machine_no', label: C.loom, kind: 'text' },
        { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
        { key: 'takeoff_count', label: C.takeoffs, kind: 'int', total: true },
        { key: 'meters', label: C.meters, kind: 'm', total: true },
        { key: 'kgs', label: C.kgs, kind: 'kg', total: true },
      ], rows.sort((a, b) => String(a.period).localeCompare(String(b.period)) || String(b.factory_code).localeCompare(String(a.factory_code)) || String(a.machine_no).localeCompare(String(b.machine_no))));
    }
    case 'beam-register':
    case 'variance': {
      const beams = await fetchAll<BeamSummary>((from, to) => {
        let q = db.from('v_beam_summary').select('*').gte('created_date', p.from).lte('created_date', p.to);
        if (p.factoryId) q = q.eq('factory_id', p.factoryId);
        return q.order('created_date').order('beam_no').range(from, to);
      });
      if (kind === 'beam-register') {
        const rows: Row[] = beams.map((b) => ({
          beam_no: b.beam_no, created_date: b.created_date, factory_code: b.factory_code, fabric_quality_name: b.fabric_quality_name,
          machine_no: b.machine_no, status: L.beam.statuses[b.status], warp_kg: b.warp_kg, weft_kg: b.weft_kg, total_yarn_kg: b.total_yarn_kg,
          grey_meters: b.grey_meters, grey_kg: b.grey_kg, wastage_kg: b.takeoff_count ? b.wastage_kg : null,
          wastage_pct: b.takeoff_count ? b.wastage_pct : null, meters_per_kg: b.meters_per_kg,
        }));
        return table(kind, p, [
          { key: 'beam_no', label: C.beam, kind: 'text' },
          { key: 'created_date', label: C.date, kind: 'date' },
          { key: 'factory_code', label: C.factory, kind: 'text' },
          { key: 'fabric_quality_name', label: C.fabricQuality, kind: 'text' },
          { key: 'machine_no', label: C.loom, kind: 'text' },
          { key: 'status', label: C.status, kind: 'text' },
          { key: 'warp_kg', label: C.warp, kind: 'kg', total: true },
          { key: 'weft_kg', label: C.weft, kind: 'kg', total: true },
          { key: 'total_yarn_kg', label: C.yarn, kind: 'kg', total: true },
          { key: 'grey_meters', label: C.greyM, kind: 'm', total: true },
          { key: 'grey_kg', label: C.greyKg, kind: 'kg', total: true },
          { key: 'wastage_kg', label: C.wastageKg, kind: 'kg', total: true },
          { key: 'wastage_pct', label: C.wastagePct, kind: 'pct' },
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

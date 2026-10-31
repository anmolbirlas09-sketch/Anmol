import { fmtDate, fmtKg, fmtM, fmtPct } from '../format';
import { L } from '../labels';

export const REPORT_KINDS = ['specifications', 'production', 'loom-production', 'beam-register', 'rolls', 'yarn-quality', 'yarn-lot', 'grey-summary', 'variance'] as const;

/** Reports that can be narrowed to a loom, fabric quality or beam. */
export const FILTERABLE: readonly ReportKind[] = ['specifications', 'production', 'loom-production', 'beam-register', 'rolls', 'variance'];
export type ReportKind = (typeof REPORT_KINDS)[number];
export const isReportKind = (k: string): k is ReportKind => (REPORT_KINDS as readonly string[]).includes(k);

export type ColumnKind = 'text' | 'date' | 'month' | 'kg' | 'm' | 'pct' | 'int' | 'ratio' | 'flag';

export interface Column {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Sum this column in the totals row, or compute the total cell (e.g. a weighted %). */
  total?: boolean | ((rows: Row[]) => Cell);
}

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface ReportParams {
  from: string; // YYYY-MM-DD
  to: string;
  factoryId?: string;
  factoryCode?: string; // for titles
  period: 'day' | 'month';
  loomId?: string;
  loomNo?: string; // for titles
  fabricQualityId?: string;
  fabricQualityName?: string; // for titles
  fabricSpecificationId?: string;
  specCode?: string; // for titles
  beamNo?: string;
  /** Specification report: list each specification under its parent (default) or parents only. */
  showSpecs?: boolean;
}

export interface ReportTable {
  kind: ReportKind;
  title: string;
  /** e.g. "01-10-2026 to 29-10-2026 · L-76" */
  subtitle: string;
  columns: Column[];
  rows: Row[];
  totals: Row | null;
  /** Rows to highlight (variance over the limit). */
  flagged?: boolean[];
  /** Rows shown as sub-rows (specifications under their parent quality). */
  indented?: boolean[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Display text for a cell, same in HTML and PDF. */
export function formatCell(kind: ColumnKind, v: Cell): string {
  if (v === null || v === undefined || v === '') return kind === 'text' ? '' : '—';
  switch (kind) {
    case 'kg': return fmtKg(v as number);
    case 'm': return fmtM(v as number);
    case 'pct': return fmtPct(v as number);
    case 'int': return String(v);
    case 'ratio': return Number(v).toFixed(3);
    case 'date': return fmtDate(String(v));
    case 'month': {
      const [y, m] = String(v).split('-');
      return `${MONTHS[Number(m) - 1]} ${y}`;
    }
    case 'flag': return v ? L.reports.col.flag : '';
    default: return String(v);
  }
}

export const isNumeric = (k: ColumnKind) => k === 'kg' || k === 'm' || k === 'pct' || k === 'int' || k === 'ratio';

/** Sum the `total` columns; round to the column's precision to avoid float noise. */
export function totalsFor(columns: Column[], rows: Row[]): Row | null {
  if (!columns.some((c) => c.total) || rows.length === 0) return null;
  const t: Row = {};
  for (const c of columns) {
    if (!c.total) continue;
    if (typeof c.total === 'function') {
      t[c.key] = c.total(rows);
      continue;
    }
    // Only recorded values count; if none were recorded the total stays empty (not 0).
    const known = rows.map((r) => r[c.key]).filter((v) => v !== null && v !== undefined && v !== '');
    if (!known.length) {
      t[c.key] = null;
      continue;
    }
    const dp = c.kind === 'm' ? 2 : c.kind === 'int' ? 0 : 3;
    const sum = known.reduce<number>((s, v) => s + Number(v), 0);
    t[c.key] = Math.round(sum * 10 ** dp) / 10 ** dp;
  }
  t[columns[0].key] = L.reports.total;
  return t;
}

/** Totals-row helper: Σ wasted ÷ Σ total × 100 (weighted, not an average of %s). */
export const weightedPct = (partKey: string, wholeKey: string) => (rows: Row[]): Cell => {
  const whole = rows.reduce((s, r) => s + (Number(r[wholeKey]) || 0), 0);
  if (!whole) return null;
  return Math.round((rows.reduce((s, r) => s + (Number(r[partKey]) || 0), 0) / whole) * 10000) / 100;
};

export function subtitleFor(p: ReportParams): string {
  const extra = [p.loomNo, p.fabricQualityName, p.specCode, p.beamNo && `${L.reports.beamNo} ${p.beamNo}`].filter(Boolean);
  return [`${fmtDate(p.from)} to ${fmtDate(p.to)}`, p.factoryCode ?? L.app.allFactories, ...extra].join(' · ');
}

export function fileNameFor(r: ReportTable, p: ReportParams, ext: string): string {
  const f = (p.factoryCode ?? 'all').replace(/[^A-Za-z0-9-]/g, '');
  return `${r.kind}_${f}_${p.from}_${p.to}.${ext}`;
}

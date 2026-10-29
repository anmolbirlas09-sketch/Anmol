// Excel import of opening stock: template generation and row-by-row checking.
// Pure functions over ExcelJS workbooks + master lists, so they are unit-tested
// without a database. Nothing here writes data.
import ExcelJS from 'exceljs';
import { fmtDate, todayIST } from './format';

export type ImportKind = 'yarn' | 'grey';
export const isImportKind = (k: string): k is ImportKind => k === 'yarn' || k === 'grey';

interface ColumnSpec {
  key: string;
  header: string;
  required: boolean;
  note: string;
  width: number;
}

export const IMPORT_COLUMNS: Record<ImportKind, ColumnSpec[]> = {
  yarn: [
    { key: 'lot_no', header: 'Lot No', required: true, note: 'Unique, e.g. A-101', width: 14 },
    { key: 'yarn_quality', header: 'Yarn Quality', required: true, note: 'Exactly as in the Lists sheet', width: 26 },
    { key: 'factory', header: 'Factory', required: true, note: 'L-76 or L-75', width: 10 },
    { key: 'kgs', header: 'Kgs', required: true, note: 'Balance on the opening date, up to 3 decimals', width: 12 },
    { key: 'date', header: 'Date', required: false, note: 'DD-MM-YYYY; blank = today', width: 13 },
    { key: 'supplier', header: 'Supplier', required: false, note: 'Optional; must exist in Masters', width: 24 },
    { key: 'challan_no', header: 'Challan No', required: false, note: 'Optional', width: 14 },
    { key: 'bags', header: 'Bags', required: false, note: 'Optional whole number', width: 8 },
    { key: 'cones', header: 'Cones', required: false, note: 'Optional whole number', width: 8 },
    { key: 'rate', header: 'Rate per kg', required: false, note: 'Optional, ₹', width: 12 },
    { key: 'notes', header: 'Notes', required: false, note: 'Optional', width: 24 },
  ],
  grey: [
    { key: 'fabric_quality', header: 'Fabric Quality', required: true, note: 'Exactly as in the Lists sheet', width: 26 },
    { key: 'factory', header: 'Factory', required: true, note: 'L-76 or L-75', width: 10 },
    { key: 'meters', header: 'Meters', required: true, note: 'Up to 2 decimals', width: 12 },
    { key: 'kgs', header: 'Kgs', required: true, note: 'Up to 3 decimals', width: 12 },
    { key: 'date', header: 'Date', required: false, note: 'DD-MM-YYYY; blank = today', width: 13 },
    { key: 'notes', header: 'Notes', required: false, note: 'Optional', width: 24 },
  ],
};

export const SHEET_NAME: Record<ImportKind, string> = { yarn: 'Opening yarn', grey: 'Opening grey' };

export interface ImportMasters {
  yarnQualities: { id: string; name: string }[];
  fabricQualities: { id: string; name: string }[];
  factories: { id: string; code: string }[];
  suppliers: { id: string; name: string }[];
  /** Lot numbers already in the database (any case). */
  existingLotNos: string[];
  /** If set, rows for other factories are refused (factory-scoped users). */
  allowedFactoryIds?: string[] | null;
}

export interface YarnImportRow {
  row: number;
  lot_no: string;
  yarn_quality_id: string;
  yarn_quality_name: string;
  factory_id: string;
  factory_code: string;
  kgs_received: number;
  inward_date: string;
  supplier_id?: string;
  challan_no?: string;
  bags_count?: number;
  cones_count?: number;
  rate_per_kg?: number;
  notes?: string;
}

export interface GreyImportRow {
  row: number;
  fabric_quality_id: string;
  fabric_quality_name: string;
  factory_id: string;
  factory_code: string;
  meters: number;
  kgs: number;
  entry_date: string;
  notes?: string;
}

export interface ImportError {
  row: number;
  message: string;
}

export type ParseResult =
  | { kind: 'yarn'; rows: YarnImportRow[]; errors: ImportError[] }
  | { kind: 'grey'; rows: GreyImportRow[]; errors: ImportError[] };

// ---------------------------------------------------------------- templates

export function templateWorkbook(kind: ImportKind, m: Pick<ImportMasters, 'yarnQualities' | 'fabricQualities' | 'factories' | 'suppliers'>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const cols = IMPORT_COLUMNS[kind];
  const ws = wb.addWorksheet(SHEET_NAME[kind], { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).eachCell((cell, i) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cols[i - 1].required ? 'FFFDE68A' : 'FFE5E7EB' } };
    cell.note = cols[i - 1].note;
  });

  // Lists sheet: the valid names, used for dropdowns.
  const lists = wb.addWorksheet('Lists');
  const qualities = kind === 'yarn' ? m.yarnQualities.map((q) => q.name) : m.fabricQualities.map((q) => q.name);
  lists.columns = [
    { header: kind === 'yarn' ? 'Yarn Quality' : 'Fabric Quality', key: 'q', width: 30 },
    { header: 'Factory', key: 'f', width: 10 },
    ...(kind === 'yarn' ? [{ header: 'Supplier', key: 's', width: 30 }] : []),
  ];
  lists.getRow(1).font = { bold: true };
  const n = Math.max(qualities.length, m.factories.length, kind === 'yarn' ? m.suppliers.length : 0);
  for (let i = 0; i < n; i++) {
    lists.addRow([qualities[i] ?? null, m.factories[i]?.code ?? null, ...(kind === 'yarn' ? [m.suppliers[i]?.name ?? null] : [])]);
  }
  const colLetter = (key: string) => String.fromCharCode(65 + cols.findIndex((c) => c.key === key));
  const listRule = (col: string, n: number) => ({ type: 'list' as const, allowBlank: true, formulae: [`Lists!$${col}$2:$${col}$${Math.max(2, n + 1)}`] });
  const dv = (ws as unknown as { dataValidations: { add(range: string, rule: object): void } }).dataValidations;
  dv.add(`${colLetter(kind === 'yarn' ? 'yarn_quality' : 'fabric_quality')}2:${colLetter(kind === 'yarn' ? 'yarn_quality' : 'fabric_quality')}2000`, listRule('A', qualities.length));
  dv.add(`${colLetter('factory')}2:${colLetter('factory')}2000`, listRule('B', m.factories.length));
  if (kind === 'yarn') dv.add(`${colLetter('supplier')}2:${colLetter('supplier')}2000`, listRule('C', m.suppliers.length));
  ws.getColumn(colLetter('date')).numFmt = 'dd-mm-yyyy';

  const help = wb.addWorksheet('Instructions');
  help.getColumn(1).width = 18;
  help.getColumn(2).width = 60;
  help.addRow([kind === 'yarn' ? 'Opening yarn stock' : 'Opening grey stock']).font = { bold: true, size: 14 };
  help.addRow([`Fill the "${SHEET_NAME[kind]}" sheet, one row per ${kind === 'yarn' ? 'yarn lot' : 'fabric quality per factory'}. Yellow columns are required.`]);
  help.addRow(['Nothing is saved unless every row is valid; the app lists any problems by row number.']);
  help.addRow([]);
  for (const c of cols) help.addRow([c.header, `${c.required ? 'Required. ' : ''}${c.note}`]);
  return wb;
}

// ---------------------------------------------------------------- parsing

type Plain = string | number | Date | null;

/** ExcelJS cell value → plain value (handles formulas, rich text, hyperlinks). */
function plain(v: ExcelJS.CellValue): Plain {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('result' in v) return plain((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text);
  }
  return String(v);
}

const text = (v: Plain) => (v === null ? '' : v instanceof Date ? v.toISOString() : String(v).trim());

function toIsoDate(v: Plain): string | null {
  if (v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10); // ExcelJS gives dates at UTC midnight
  if (typeof v === 'number') {
    if (v < 1 || v > 100000) return 'invalid';
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = v.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (mt) [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return 'invalid';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'invalid';
  return dt.toISOString().slice(0, 10);
}

function toNumber(v: Plain, dp: number): number | 'invalid' | null {
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 'invalid';
  return Math.round(n * 10 ** dp) / 10 ** dp; // spreadsheet floats like 1000.0000001
}

export async function readWorkbook(data: ArrayBuffer | Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  return wb;
}

export function parseWorkbook(wb: ExcelJS.Workbook, kind: ImportKind, m: ImportMasters, today = todayIST()): ParseResult {
  const ws = wb.getWorksheet(SHEET_NAME[kind]) ?? wb.worksheets[0];
  const cols = IMPORT_COLUMNS[kind];
  const errors: ImportError[] = [];
  if (!ws) return { kind, rows: [], errors: [{ row: 0, message: 'No sheet found' }] } as ParseResult;

  // Map headers to columns by name, so column order in the file does not matter.
  const headerRow = ws.getRow(1);
  const pos: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    const h = text(plain(cell.value)).toLowerCase();
    const spec = cols.find((c) => h === c.header.toLowerCase() || h.startsWith(c.header.toLowerCase()));
    if (spec && !(spec.key in pos)) pos[spec.key] = colNumber;
  });
  const missing = cols.filter((c) => c.required && !(c.key in pos)).map((c) => c.header);
  if (missing.length) {
    return { kind, rows: [], errors: [{ row: 1, message: `Missing column(s): ${missing.join(', ')}` }] } as ParseResult;
  }

  const byName = <T extends { name: string }>(list: T[]) => new Map(list.map((x) => [x.name.trim().toLowerCase(), x]));
  const yq = byName(m.yarnQualities);
  const fq = byName(m.fabricQualities);
  const sup = byName(m.suppliers);
  const fac = new Map(m.factories.map((f) => [f.code.toLowerCase(), f]));
  const facLoose = new Map(m.factories.map((f) => [f.code.replace(/-/g, '').toLowerCase(), f])); // "L76" = "L-76"
  const existingLots = new Set(m.existingLotNos.map((l) => l.trim().toUpperCase()));
  const seenLots = new Map<string, number>();
  const seenGrey = new Map<string, number>();

  const yarnRows: YarnImportRow[] = [];
  const greyRows: GreyImportRow[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (key: string): Plain => (key in pos ? plain(row.getCell(pos[key]).value) : null);
    if (cols.every((c) => text(get(c.key)) === '')) continue; // blank line
    const err = (message: string) => errors.push({ row: r, message });
    const before = errors.length;

    const factoryText = text(get('factory'));
    const factory = fac.get(factoryText.toLowerCase()) ?? facLoose.get(factoryText.replace(/-/g, '').toLowerCase());
    if (!factoryText) err('Factory is required');
    else if (!factory) err(`Unknown factory "${factoryText}"`);
    else if (m.allowedFactoryIds && !m.allowedFactoryIds.includes(factory.id)) err(`You cannot import stock for ${factory.code}`);

    let date = toIsoDate(get('date'));
    if (date === 'invalid') err(`Date "${text(get('date'))}" is not a valid DD-MM-YYYY date`);
    else if (date && date > today) err(`Date ${fmtDate(date)} is in the future`);
    date = date && date !== 'invalid' ? date : today;

    const notes = text(get('notes')) || undefined;

    if (kind === 'yarn') {
      const lotNo = text(get('lot_no')).toUpperCase();
      if (!lotNo) err('Lot No is required');
      else if (existingLots.has(lotNo)) err(`Lot ${lotNo} already exists`);
      else if (seenLots.has(lotNo)) err(`Lot ${lotNo} is repeated (also row ${seenLots.get(lotNo)})`);
      if (lotNo) seenLots.set(lotNo, seenLots.get(lotNo) ?? r);

      const qText = text(get('yarn_quality'));
      const q = yq.get(qText.toLowerCase());
      if (!qText) err('Yarn Quality is required');
      else if (!q) err(`Unknown yarn quality "${qText}"`);

      const kgs = toNumber(get('kgs'), 3);
      if (kgs === null) err('Kgs is required');
      else if (kgs === 'invalid' || kgs <= 0) err(`Kgs "${text(get('kgs'))}" must be a number above 0`);

      const sText = text(get('supplier'));
      const s = sText ? sup.get(sText.toLowerCase()) : undefined;
      if (sText && !s) err(`Unknown supplier "${sText}"`);

      const whole = (key: string, label: string) => {
        const n = toNumber(get(key), 3);
        if (n === 'invalid' || (typeof n === 'number' && (n < 0 || !Number.isInteger(n)))) {
          err(`${label} must be a whole number`);
          return undefined;
        }
        return n ?? undefined;
      };
      const bags = whole('bags', 'Bags');
      const cones = whole('cones', 'Cones');
      const rate = toNumber(get('rate'), 2);
      if (rate === 'invalid' || (typeof rate === 'number' && rate < 0)) err('Rate per kg must be a number');

      if (errors.length === before && q && factory && typeof kgs === 'number') {
        yarnRows.push({
          row: r, lot_no: lotNo, yarn_quality_id: q.id, yarn_quality_name: q.name, factory_id: factory.id, factory_code: factory.code,
          kgs_received: kgs, inward_date: date, supplier_id: s?.id, challan_no: text(get('challan_no')) || undefined,
          bags_count: bags, cones_count: cones, rate_per_kg: typeof rate === 'number' ? rate : undefined, notes,
        });
      }
    } else {
      const qText = text(get('fabric_quality'));
      const q = fq.get(qText.toLowerCase());
      if (!qText) err('Fabric Quality is required');
      else if (!q) err(`Unknown fabric quality "${qText}"`);

      const meters = toNumber(get('meters'), 2);
      const kgs = toNumber(get('kgs'), 3);
      if (meters === null) err('Meters is required');
      else if (meters === 'invalid' || meters < 0) err(`Meters "${text(get('meters'))}" must be a number`);
      if (kgs === null) err('Kgs is required');
      else if (kgs === 'invalid' || kgs < 0) err(`Kgs "${text(get('kgs'))}" must be a number`);
      if (meters === 0 && kgs === 0) err('Meters and Kgs cannot both be 0');

      if (q && factory) {
        const k = `${q.id}:${factory.id}`;
        if (seenGrey.has(k)) err(`${q.name} at ${factory.code} is repeated (also row ${seenGrey.get(k)})`);
        else seenGrey.set(k, r);
      }

      if (errors.length === before && q && factory && typeof meters === 'number' && typeof kgs === 'number') {
        greyRows.push({ row: r, fabric_quality_id: q.id, fabric_quality_name: q.name, factory_id: factory.id, factory_code: factory.code, meters, kgs, entry_date: date, notes });
      }
    }
  }

  return kind === 'yarn' ? { kind, rows: yarnRows, errors } : { kind, rows: greyRows, errors };
}

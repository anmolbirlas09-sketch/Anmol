import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS, SHEET_NAME, parseWorkbook, readWorkbook, templateWorkbook, type GreyImportRow, type ImportMasters } from '@/lib/importer';

const masters: ImportMasters = {
  yarnQualities: [{ id: 'yq-white', name: 'Mono 0.25 White' }, { id: 'yq-black', name: 'Mono 0.25 Black' }],
  fabricQualities: [{ id: 'fq-mw', name: 'Mono White' }, { id: 'fq-wb', name: 'White/Black' }],
  factories: [{ id: 'f76', code: 'L-76' }, { id: 'f75', code: 'L-75' }],
  suppliers: [{ id: 's1', name: 'Navsari Yarns' }],
  specifications: [
    { id: 'sp-mw1', spec_code: 'MONOWHITE-S1', fabric_quality_id: 'fq-mw' },
    { id: 'sp-wb1', spec_code: 'WHITEBLACK-S1', fabric_quality_id: 'fq-wb' },
  ],
  existingLotNos: ['a-100'],
};
const TODAY = '2026-10-29';

/** Build an import file the way a user would: from the template, then typing rows. */
async function fileWith(kind: 'yarn' | 'grey', rows: unknown[][]) {
  const wb = templateWorkbook(kind, masters);
  const ws = wb.getWorksheet(SHEET_NAME[kind])!;
  for (const r of rows) ws.addRow(r);
  return readWorkbook(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

describe('templates', () => {
  it('have the headers, a Lists sheet for dropdowns, and instructions', async () => {
    const wb = await readWorkbook(await templateWorkbook('yarn', masters).xlsx.writeBuffer() as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Opening yarn', 'Lists', 'Instructions']);
    const headers = (wb.getWorksheet('Opening yarn')!.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(IMPORT_COLUMNS.yarn.map((c) => c.header));
    expect(wb.getWorksheet('Lists')!.getCell('A2').value).toBe('Mono 0.25 White');
    expect(wb.getWorksheet('Lists')!.getCell('B3').value).toBe('L-75');
    expect(wb.getWorksheet('Opening yarn')!.rowCount).toBe(1); // no example rows that could be imported by mistake
  });
});

describe('yarn import', () => {
  it('reads valid rows: dates as Excel dates or DD-MM-YYYY text, blank date = today, names any case', async () => {
    const wb = await fileWith('yarn', [
      ['a-101', 'mono 0.25 white', 'L-76', 1000, new Date(Date.UTC(2026, 3, 1)), 'Navsari Yarns', 'CH-1', 20, 400, 145.5, 'opening'],
      ['B-202', 'Mono 0.25 Black', 'L75', '1,234.5678', '15-04-2026'],
      ['C-303', 'Mono 0.25 Black', 'L-75', 50],
    ]);
    const r = parseWorkbook(wb, 'yarn', masters, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      expect.objectContaining({ row: 2, lot_no: 'A-101', yarn_quality_id: 'yq-white', factory_id: 'f76', kgs_received: 1000, inward_date: '2026-04-01', supplier_id: 's1', challan_no: 'CH-1', bags_count: 20, cones_count: 400, rate_per_kg: 145.5 }),
      expect.objectContaining({ row: 3, lot_no: 'B-202', factory_code: 'L-75', kgs_received: 1234.568, inward_date: '2026-04-15' }),
      expect.objectContaining({ row: 4, lot_no: 'C-303', inward_date: TODAY }),
    ]);
  });

  it('reports every problem with its Excel row number', async () => {
    const wb = await fileWith('yarn', [
      ['A-100', 'Mono 0.25 White', 'L-76', 10], // exists already
      ['D-1', 'Mono Pink', 'L-77', -5, '31-02-2026'],
      ['D-2', 'Mono 0.25 White', 'L-76', 'ten', '01-01-2030', 'Unknown Co', '', 2.5],
      ['D-3', 'Mono 0.25 White', 'L-76', 1],
      [],
      ['d-3', 'Mono 0.25 White', 'L-76', 1],
    ]);
    const r = parseWorkbook(wb, 'yarn', masters, TODAY);
    expect(r.errors).toEqual([
      { row: 2, message: 'Lot A-100 already exists' },
      { row: 3, message: 'Unknown factory "L-77"' },
      { row: 3, message: 'Date "31-02-2026" is not a valid DD-MM-YYYY date' },
      { row: 3, message: 'Unknown yarn quality "Mono Pink"' },
      { row: 3, message: 'Kgs "-5" must be a number above 0' },
      { row: 4, message: 'Date 01-01-2030 is in the future' },
      { row: 4, message: 'Kgs "ten" must be a number above 0' },
      { row: 4, message: 'Unknown supplier "Unknown Co"' },
      { row: 4, message: 'Bags must be a whole number' },
      { row: 7, message: 'Lot D-3 is repeated (also row 5)' },
    ]);
    expect(r.rows.map((x) => x.row)).toEqual([5]);
  });

  it('refuses other factories for factory-scoped users and missing columns', async () => {
    const r = parseWorkbook(await fileWith('yarn', [['E-1', 'Mono 0.25 White', 'L-75', 5]]), 'yarn', { ...masters, allowedFactoryIds: ['f76'] }, TODAY);
    expect(r.errors).toEqual([{ row: 2, message: 'You cannot import stock for L-75' }]);

    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Opening yarn').addRow(['Lot No', 'Kgs']);
    expect(parseWorkbook(wb, 'yarn', masters, TODAY).errors).toEqual([{ row: 1, message: 'Missing column(s): Yarn Quality, Factory' }]);
  });
});

describe('grey import', () => {
  it('reads rows (Specification ID optional when the quality has one) and rejects repeats of the same spec + factory', async () => {
    const wb = await fileWith('grey', [
      ['Mono White', '', 'L-76', 1000, 520, '01-10-2026'],
      ['White/Black', 'whiteblack-s1', 'L-75', '800.005', 420],
      ['mono white', 'MONOWHITE-S1', 'l-76', 5, 2],
      ['Mono White', '', 'L-75', 0, 0],
      ['Mono White', 'WHITEBLACK-S1', 'L-75', 1, 1],
    ]);
    const r = parseWorkbook(wb, 'grey', masters, TODAY);
    expect(r.errors).toEqual([
      { row: 4, message: 'Mono White · MONOWHITE-S1 at L-76 is repeated (also row 2)' },
      { row: 5, message: 'Meters and Kgs cannot both be 0' },
      { row: 6, message: 'Specification "WHITEBLACK-S1" is not one of Mono White\'s' },
    ]);
    expect(r.rows).toEqual([
      { row: 2, fabric_quality_id: 'fq-mw', fabric_quality_name: 'Mono White', fabric_specification_id: 'sp-mw1', spec_code: 'MONOWHITE-S1', factory_id: 'f76', factory_code: 'L-76', meters: 1000, kgs: 520, entry_date: '2026-10-01', notes: undefined },
      { row: 3, fabric_quality_id: 'fq-wb', fabric_quality_name: 'White/Black', fabric_specification_id: 'sp-wb1', spec_code: 'WHITEBLACK-S1', factory_id: 'f75', factory_code: 'L-75', meters: 800.01, kgs: 420, entry_date: TODAY, notes: undefined },
    ]);
  });

  it('a quality with several specifications needs the Specification ID', async () => {
    const m = { ...masters, specifications: [...masters.specifications!, { id: 'sp-mw2', spec_code: 'MONOWHITE-S2', fabric_quality_id: 'fq-mw' }] };
    const wb = await fileWith('grey', [['Mono White', '', 'L-76', 10, 5], ['Mono White', 'MONOWHITE-S2', 'L-76', 10, 5]]);
    const r = parseWorkbook(wb, 'grey', m, TODAY);
    expect(r.errors).toEqual([{ row: 2, message: 'Mono White has 2 specifications: give the Specification ID' }]);
    expect((r.rows as GreyImportRow[]).map((x) => x.spec_code)).toEqual(['MONOWHITE-S2']);
  });
});

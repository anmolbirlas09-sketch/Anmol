import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { reportToPdf, reportToXlsx } from '@/lib/reports/export';
import { formatCell, totalsFor, type Column, type ReportTable } from '@/lib/reports/model';

const columns: Column[] = [
  { key: 'q', label: 'Fabric quality', kind: 'text' },
  { key: 'd', label: 'Date', kind: 'date' },
  { key: 'm', label: 'Meters', kind: 'm', total: true },
  { key: 'kg', label: 'Kg', kind: 'kg', total: true },
  { key: 'p', label: 'Var %', kind: 'pct' },
];
const rows = [
  { q: 'Mono White', d: '2026-10-29', m: 1200, kg: 650.1, p: 4.02 },
  { q: 'White/Black', d: '2026-10-28', m: 800.2, kg: 420.2, p: null },
];
const report: ReportTable = { kind: 'grey-summary', title: 'Grey stock summary', subtitle: '01-10-2026 to 29-10-2026 · All factories', columns, rows, totals: totalsFor(columns, rows), flagged: [true, false] };

describe('report model', () => {
  it('totals the summed columns without float noise', () => {
    expect(report.totals).toEqual({ q: 'Total', m: 2000.2, kg: 1070.3 });
  });
  it('formats cells like the rest of the app', () => {
    expect(formatCell('kg', 1070.3)).toBe('1,070.300');
    expect(formatCell('m', 2000)).toBe('2,000.00');
    expect(formatCell('date', '2026-10-29')).toBe('29-10-2026');
    expect(formatCell('month', '2026-10-01')).toBe('Oct 2026');
    expect(formatCell('pct', null)).toBe('—');
  });
});

describe('exports', () => {
  it('Excel: title rows, header, real numbers and dates with formats, totals row', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await reportToXlsx(report, new Date('2026-10-29T10:00:00Z'))) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('Grey stock summary');
    expect(ws.getCell('A3').value).toBe('Generated 29-10-2026 15:30');
    expect((ws.getRow(4).values as unknown[]).slice(1)).toEqual(['Fabric quality', 'Date', 'Meters', 'Kg', 'Var %']);
    expect(ws.getCell('C5').value).toBe(1200);
    expect(ws.getCell('C5').numFmt).toBe('#,##0.00');
    expect(ws.getCell('D5').numFmt).toBe('#,##0.000');
    expect((ws.getCell('B5').value as Date).toISOString().slice(0, 10)).toBe('2026-10-29');
    expect(ws.getCell('B5').numFmt).toBe('dd-mm-yyyy');
    expect(ws.getCell('E6').value).toBeNull();
    expect([ws.getCell('A7').value, ws.getCell('B7').value, ws.getCell('C7').value, ws.getCell('D7').value, ws.getCell('E7').value])
      .toEqual(['Total', null, 2000.2, 1070.3, null]);
  });

  it('PDF: a real PDF document', () => {
    const pdf = reportToPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
  });
});

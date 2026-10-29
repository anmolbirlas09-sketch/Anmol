import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { fmtDateTime } from '../format';
import { L } from '../labels';
import { formatCell, isNumeric, type Column, type ReportTable } from './model';

const EXCEL_FORMAT: Partial<Record<Column['kind'], string>> = {
  kg: '#,##0.000',
  m: '#,##0.00',
  pct: '0.00"%"',
  int: '0',
  ratio: '0.000',
};

/** Real numbers and dates in Excel (so totals/filters work), formatted like the app. */
export async function reportToXlsx(r: ReportTable, generatedAt = new Date()): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = L.app.name;
  wb.created = generatedAt;
  const ws = wb.addWorksheet(r.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });

  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]);
  ws.addRow([L.reports.generated(fmtDateTime(generatedAt.toISOString()))]).font = { italic: true, color: { argb: 'FF666666' } };
  const head = ws.addRow(r.columns.map((c) => c.label));
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5EDFF' } };
    cell.border = { bottom: { style: 'thin' } };
  });

  const toCell = (c: Column, v: unknown) => {
    if (v === null || v === undefined || v === '') return null;
    if (c.kind === 'date' || c.kind === 'month') {
      const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    }
    if (c.kind === 'flag') return v ? L.reports.col.flag : '';
    if (isNumeric(c.kind)) return Number(v);
    return String(v);
  };

  r.rows.forEach((row, i) => {
    const xr = ws.addRow(r.columns.map((c) => toCell(c, row[c.key])));
    if (r.flagged?.[i]) xr.eachCell((cell) => (cell.font = { color: { argb: 'FFB91C1C' }, bold: true }));
  });
  if (r.totals) {
    const tr = ws.addRow(r.columns.map((c, i) => (i === 0 ? L.reports.total : c.total ? toCell(c, r.totals![c.key]) : null)));
    tr.font = { bold: true };
    tr.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
  }

  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (EXCEL_FORMAT[c.kind]) col.numFmt = EXCEL_FORMAT[c.kind]!;
    if (c.kind === 'date') col.numFmt = 'dd-mm-yyyy';
    if (c.kind === 'month') col.numFmt = 'mmm yyyy';
    col.width = Math.max(10, Math.min(28, c.label.length + 4, ...r.rows.slice(0, 200).map((row) => formatCell(c.kind, row[c.key]).length + 2)));
    if (isNumeric(c.kind)) col.alignment = { horizontal: 'right' };
  });
  ws.getRow(1).alignment = { horizontal: 'left' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A4 landscape PDF with a repeating header row and page numbers. */
export function reportToPdf(r: ReportTable, generatedAt = new Date()): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text(r.title, 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`${r.subtitle}   ·   ${L.reports.generated(fmtDateTime(generatedAt.toISOString()))}`, 14, 21);

  const body = r.rows.map((row) => r.columns.map((c) => formatCell(c.kind, row[c.key])));
  const foot = r.totals ? [r.columns.map((c, i) => (i === 0 ? L.reports.total : c.total ? formatCell(c.kind, r.totals![c.key]) : ''))] : undefined;

  autoTable(doc, {
    startY: 25,
    head: [r.columns.map((c) => c.label)],
    body: body.length ? body : [[L.reports.empty, ...r.columns.slice(1).map(() => '')]],
    foot,
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [29, 78, 216], textColor: 255 },
    footStyles: { fillColor: [238, 240, 243], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(r.columns.map((c, i) => [i, isNumeric(c.kind) ? { halign: 'right' } : {}])),
    didParseCell: (d) => {
      if (d.section === 'body' && r.flagged?.[d.row.index]) {
        d.cell.styles.textColor = [185, 28, 28];
        d.cell.styles.fontStyle = 'bold';
      }
      if (d.section !== 'body' && isNumeric(r.columns[d.column.index]?.kind)) d.cell.styles.halign = 'right';
    },
    didDrawPage: () => {
      const page = doc.getCurrentPageInfo().pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`${L.app.name} · ${r.title} · ${page}`, 14, doc.internal.pageSize.getHeight() - 6);
    },
  });

  return Buffer.from(doc.output('arraybuffer'));
}

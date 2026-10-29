// Display formats: kg to 3 decimals, meters to 2, dates DD-MM-YYYY, Asia/Kolkata.

export const TIME_ZONE = 'Asia/Kolkata';

const kgFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const mFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });

type Num = number | string | null | undefined;
const isBlank = (v: Num) => v === null || v === undefined || v === '' || Number.isNaN(Number(v));

export const fmtKg = (v: Num) => (isBlank(v) ? '—' : kgFormat.format(Number(v)));
export const fmtM = (v: Num) => (isBlank(v) ? '—' : mFormat.format(Number(v)));
export const fmtPct = (v: Num) => (isBlank(v) ? '—' : `${pctFormat.format(Number(v))}%`);

/** '2026-10-29' → '29-10-2026' */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m && v.length === 10) return `${m[3]}-${m[2]}-${m[1]}`;
  return fmtDateTime(v, false);
}

/** timestamptz → '29-10-2026 14:05' in IST */
export function fmtDateTime(v: string | null | undefined, withTime = true): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.day}-${parts.month}-${parts.year}`;
  return withTime ? `${date} ${parts.hour}:${parts.minute}` : date;
}

/** Today in Asia/Kolkata as YYYY-MM-DD (for <input type="date"> defaults). */
export function todayIST(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

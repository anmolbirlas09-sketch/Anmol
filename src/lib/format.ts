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

/**
 * The shift running now in Asia/Kolkata and the production date it belongs to.
 * Day 08:00–20:00; night 20:00–08:00, dated by the evening it started, so an
 * entry at 02:00 on the 1st is the night shift of the 31st.
 */
export function currentShift(now = new Date()): { shift: 'day' | 'night'; date: string } {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hour12: false }).format(now)) % 24;
  if (hour >= 8 && hour < 20) return { shift: 'day', date: todayIST(now) };
  if (hour >= 20) return { shift: 'night', date: todayIST(now) };
  return { shift: 'night', date: todayIST(new Date(now.getTime() - 24 * 3600 * 1000)) };
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

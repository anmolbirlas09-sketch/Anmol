import { describe, expect, it } from 'vitest';
import { currentShift, fmtDate, fmtDateTime, fmtKg, fmtM, fmtPct, todayIST } from '@/lib/format';

describe('format', () => {
  it('kg to 3 decimals and meters to 2, Indian digit grouping', () => {
    expect(fmtKg(1000)).toBe('1,000.000');
    expect(fmtKg('123456.7')).toBe('1,23,456.700');
    expect(fmtM(2000)).toBe('2,000.00');
    expect(fmtKg(null)).toBe('—');
    expect(fmtM(undefined)).toBe('—');
  });

  it('signed percentages', () => {
    expect(fmtPct(4.02)).toBe('+4.02%');
    expect(fmtPct(-7.1)).toBe('-7.10%');
    expect(fmtPct(0)).toBe('0.00%');
    expect(fmtPct(null)).toBe('—');
  });

  it('dates as DD-MM-YYYY, timestamps in IST', () => {
    expect(fmtDate('2026-10-29')).toBe('29-10-2026');
    expect(fmtDateTime('2026-10-29T20:00:00Z')).toBe('30-10-2026 01:30');
    expect(fmtDate('2026-10-29T20:00:00Z')).toBe('30-10-2026');
    expect(fmtDate(null)).toBe('—');
  });

  it('today is computed in Asia/Kolkata, not UTC', () => {
    expect(todayIST(new Date('2026-10-29T19:00:00Z'))).toBe('2026-10-30');
    expect(todayIST(new Date('2026-10-29T18:00:00Z'))).toBe('2026-10-29');
  });
});

describe('currentShift (Asia/Kolkata)', () => {
  // IST = UTC + 5:30
  const at = (utc: string) => currentShift(new Date(utc));
  it('day shift 8 am – 8 pm', () => {
    expect(at('2026-11-01T02:30:00Z')).toEqual({ shift: 'day', date: '2026-11-01' }); // 08:00 IST
    expect(at('2026-11-01T14:29:00Z')).toEqual({ shift: 'day', date: '2026-11-01' }); // 19:59 IST
  });
  it('night shift 8 pm – 8 am, dated by the evening it started', () => {
    expect(at('2026-11-01T14:30:00Z')).toEqual({ shift: 'night', date: '2026-11-01' }); // 20:00 IST
    expect(at('2026-11-01T18:30:00Z')).toEqual({ shift: 'night', date: '2026-11-01' }); // 00:00 IST on the 2nd
    expect(at('2026-11-01T20:30:00Z')).toEqual({ shift: 'night', date: '2026-11-01' }); // 02:00 IST on the 2nd
    expect(at('2026-11-02T02:29:00Z')).toEqual({ shift: 'night', date: '2026-11-01' }); // 07:59 IST on the 2nd
  });
  it('month and year boundaries', () => {
    expect(at('2026-12-31T22:00:00Z')).toEqual({ shift: 'night', date: '2026-12-31' }); // 03:30 IST on 1 Jan
  });
});

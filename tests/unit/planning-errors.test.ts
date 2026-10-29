import { describe, expect, it } from 'vitest';
import { friendlyError } from '@/lib/errors';
import { expectedFabricLength, plannedWarpKg, plannedWeftKg, variancePct } from '@/lib/planning';

describe('planning (mirrors the SQL functions; same numbers as tests/db/schema.test.ts)', () => {
  it('computes planned warp, fabric length and weft', () => {
    expect(plannedWarpKg({ totalEnds: 1800, warpLengthM: 3000, denier: 420, crimpPct: 3 })).toBe(259.56);
    expect(expectedFabricLength(3000, 3)).toBe(2912.62);
    expect(plannedWeftKg({ picksPerInch: 24, reedWidthM: 1.8, fabricLengthM: 2912.62, denier: 420, wastagePct: 2 })).toBe(235.798);
    expect(variancePct(270, 259.56)).toBe(4.02);
  });

  it('returns null when inputs are missing', () => {
    expect(plannedWarpKg({ totalEnds: null, warpLengthM: 3000, denier: 420 })).toBeNull();
    expect(plannedWeftKg({ picksPerInch: 24, reedWidthM: 1.8, fabricLengthM: 0, denier: 420 })).toBeNull();
    expect(variancePct(10, null)).toBeNull();
  });
});

describe('friendlyError', () => {
  it('explains insufficient yarn with the available kg', () => {
    expect(
      friendlyError({ code: 'WV001', message: 'x', details: '{"lot_no":"A-101","available_kg":50,"requested_kg":100}' }),
    ).toBe('Not enough yarn in lot A-101 — only 50.000 kg available.');
  });
  it('names the duplicated field', () => {
    expect(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "yarn_lots_lot_no_key"' })).toBe(
      'This lot no already exists',
    );
  });
  it('maps permission errors and hides unknown internals', () => {
    expect(friendlyError({ code: '42501', message: 'new row violates row-level security policy' })).toBe('You do not have permission to do this.');
    expect(friendlyError({ code: 'XX000', message: 'internal' })).toBe('Something went wrong. Please try again.');
    expect(friendlyError(undefined)).toBe('Something went wrong. Please try again.');
  });
  it('passes through the database’s own loom/beam messages', () => {
    expect(friendlyError({ code: 'WV002', message: 'Loom L76-05 already has beam B-001 running.' })).toBe('Loom L76-05 already has beam B-001 running.');
  });
});

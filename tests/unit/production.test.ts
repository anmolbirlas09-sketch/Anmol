import { describe, expect, it } from 'vitest';
import { describeRolls, productionFigures, splitRolls } from '@/lib/production';
import { parseForm, productionSchema } from '@/lib/validation';

describe('production figures (same formulas as the database)', () => {
  it('680 m with 33 m wasted → 647 m net, 4.85 %', () => {
    const f = productionFigures({ meters: 680, wastedMeters: 33, rollLengthM: 100 });
    expect([f.netMeters, f.wastagePct]).toEqual([647, 4.85]);
    expect(f.rolls).toEqual([100, 100, 100, 100, 100, 100, 47]);
    expect(describeRolls(f.rolls)).toBe('6 × 100 m + 1 × 47 m');
  });

  it('estimated weight 65 GSM × 1.5 m × 250 m / 1000 = 24.375 kg', () => {
    expect(productionFigures({ meters: 250, wastedMeters: 0, gsm: 65, widthM: 1.5 }).estimatedKg).toBe(24.375);
  });

  it('missing inputs give null, not 0', () => {
    const f = productionFigures({ meters: 680, wastedMeters: 33 });
    expect([f.estimatedKg, f.totalYarnKg, f.weightWastagePctActual, f.wasteKgEstimated]).toEqual([null, null, null, null]);
    expect(f.asksForKgWastage).toBe(false);
    expect(productionFigures({ meters: 250, wastedMeters: 0, gsm: 65 }).estimatedKg).toBeNull();
    expect(productionFigures({ meters: null, wastedMeters: 3 }).netMeters).toBeNull();
  });

  it('wasted more than total → no net / % figures', () => {
    const f = productionFigures({ meters: 100, wastedMeters: 120 });
    expect([f.netMeters, f.wastagePct]).toEqual([null, null]);
  });

  it('KG wastage: actual kg → %, or % → estimated kg; asks only once a KG figure is entered', () => {
    const a = productionFigures({ meters: 680, wastedMeters: 33, warpKg: 300, weftKg: 200, wasteKg: 25 });
    expect([a.totalYarnKg, a.weightWastagePctActual, a.wasteKgEstimated, a.asksForKgWastage]).toEqual([500, 5, null, true]);
    const b = productionFigures({ meters: 680, wastedMeters: 33, warpKg: 300, weftKg: 200, wastePct: 4 });
    expect([b.weightWastagePctActual, b.wasteKgEstimated]).toEqual([null, 20]);
    const c = productionFigures({ meters: 680, wastedMeters: 33, warpKg: 300, wastePct: 4 });
    expect([c.totalYarnKg, c.wasteKgEstimated]).toEqual([null, null]);
    expect(productionFigures({ meters: 10, wastedMeters: 0, weighedKg: 5 }).asksForKgWastage).toBe(true);
  });

  it('roll split edge cases', () => {
    expect(splitRolls(200, 100)).toEqual([100, 100]);
    expect(splitRolls(50, 100)).toEqual([50]);
    expect(splitRolls(0, 100)).toEqual([]);
    expect(splitRolls(0.3, 0.1)).toEqual([0.1, 0.1, 0.1]); // no float drift
    expect(splitRolls(100.05, 25)).toEqual([25, 25, 25, 25, 0.05]);
  });
});

describe('production form validation', () => {
  const UUID = '0b0c3a3e-5f7d-4b1e-9a7c-2f1d3c4b5a69';
  const base = { loom_id: UUID, fabric_quality_id: UUID, fabric_specification_id: UUID, meters: '680', wasted_meters: '33', roll_length_m: '100', entry_date: '2026-10-31' };
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it('metres, wasted metres and roll length are required; weights optional and stay undefined', () => {
    const ok = parseForm(productionSchema, fd({ ...base, gsm: '', width_m: '', warp_kg: '' }));
    expect(ok.error).toBeUndefined();
    expect(ok.data).toMatchObject({ meters: 680, wasted_meters: 33, roll_length_m: 100 });
    expect([ok.data!.gsm, ok.data!.width_m, ok.data!.warp_kg, ok.data!.weighed_kg, ok.data!.waste_kg]).toEqual([undefined, undefined, undefined, undefined, undefined]);

    const missing = parseForm(productionSchema, fd({ loom_id: UUID, fabric_quality_id: UUID, fabric_specification_id: UUID, entry_date: '2026-10-31' })).error!;
    expect(Object.keys(missing.fieldErrors!).sort()).toEqual(['meters', 'roll_length_m', 'wasted_meters']);
  });

  it('shift: day or night only, optional', () => {
    expect(parseForm(productionSchema, fd({ ...base, shift: 'night' })).data?.shift).toBe('night');
    expect(parseForm(productionSchema, fd({ ...base, shift: '' })).data?.shift).toBeUndefined();
    expect(parseForm(productionSchema, fd({ ...base, shift: 'A' })).error?.fieldErrors?.shift).toBeTruthy();
  });

  it('0 wasted metres is allowed; more than total is not', () => {
    expect(parseForm(productionSchema, fd({ ...base, wasted_meters: '0' })).data?.wasted_meters).toBe(0);
    expect(parseForm(productionSchema, fd({ ...base, wasted_meters: '681' })).error?.fieldErrors).toEqual({ wasted_meters: 'Wasted metres cannot be more than total production' });
  });

  it('no negatives; waste kg or %, not both; kg not above the yarn', () => {
    expect(parseForm(productionSchema, fd({ ...base, warp_kg: '-1' })).error?.fieldErrors?.warp_kg).toBe('Enter a number');
    expect(parseForm(productionSchema, fd({ ...base, waste_kg: '5', waste_pct: '2' })).error?.fieldErrors?.waste_pct).toBe('Enter the waste in kg or as a %, not both');
    expect(parseForm(productionSchema, fd({ ...base, warp_kg: '3', weft_kg: '2', waste_kg: '6' })).error?.fieldErrors?.waste_kg).toBe('Waste kg cannot be more than the yarn used');
    expect(parseForm(productionSchema, fd({ ...base, gsm: '0' })).error?.fieldErrors?.gsm).toBe('Must be more than 0');
  });
});

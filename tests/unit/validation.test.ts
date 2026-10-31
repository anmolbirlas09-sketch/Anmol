import { describe, expect, it } from 'vitest';
import { beamSchema, consumptionSchema, parseForm, supplierSchema, yarnLotSchema } from '@/lib/validation';

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const UUID = '0b0c3a3e-5f7d-4b1e-9a7c-2f1d3c4b5a69';

describe('yarn lot form', () => {
  const base = { lot_no: ' a-101 ', yarn_quality_id: UUID, factory_id: UUID, inward_date: '2026-10-29', kgs_received: '1,000.5' };

  it('trims and upper-cases lot no, parses kg, drops blank optionals', () => {
    const r = parseForm(yarnLotSchema, fd({ ...base, supplier_id: '', bags_count: '', challan_no: '  ' }));
    expect(r.error).toBeUndefined();
    expect(r.data).toEqual({ lot_no: 'A-101', yarn_quality_id: UUID, factory_id: UUID, inward_date: '2026-10-29', kgs_received: 1000.5 });
  });

  it('rejects zero, negative, too many decimals and missing fields', () => {
    expect(parseForm(yarnLotSchema, fd({ ...base, kgs_received: '0' })).error?.fieldErrors).toEqual({ kgs_received: 'Must be more than 0' });
    expect(parseForm(yarnLotSchema, fd({ ...base, kgs_received: '-5' })).error?.fieldErrors?.kgs_received).toBe('Enter a number');
    expect(parseForm(yarnLotSchema, fd({ ...base, kgs_received: '1.2345' })).error?.fieldErrors?.kgs_received).toBe('Up to 3 decimals');
    const missing = parseForm(yarnLotSchema, fd({ lot_no: '', kgs_received: '' })).error!;
    expect(Object.keys(missing.fieldErrors!).sort()).toEqual(['factory_id', 'inward_date', 'kgs_received', 'lot_no', 'yarn_quality_id']);
    expect(missing.values).toEqual({ lot_no: '', kgs_received: '' });
  });

  it('bags must be whole numbers', () => {
    expect(parseForm(yarnLotSchema, fd({ ...base, bags_count: '2.5' })).error?.fieldErrors?.bags_count).toBe('Enter a number');
    expect(parseForm(yarnLotSchema, fd({ ...base, bags_count: '25' })).data?.bags_count).toBe(25);
  });
});

describe('beam and consumption forms', () => {
  it('meters allow 2 decimals', () => {
    const ok = parseForm(beamSchema, fd({ beam_no: 'b-001', fabric_quality_id: UUID, fabric_specification_id: UUID, factory_id: UUID, warp_length_m: '3000.25', created_date: '2026-10-29' }));
    expect(ok.data?.beam_no).toBe('B-001');
    expect(ok.data?.warp_length_m).toBe(3000.25);
    const bad = parseForm(beamSchema, fd({ beam_no: 'b', fabric_quality_id: UUID, fabric_specification_id: UUID, factory_id: UUID, warp_length_m: '1.234', created_date: '2026-10-29' }));
    expect(bad.error?.fieldErrors?.warp_length_m).toBe('Up to 2 decimals');
  });

  it('usage must be warp or weft', () => {
    const r = parseForm(consumptionSchema, fd({ beam_id: UUID, yarn_lot_id: UUID, usage_type: 'other', kgs: '10', entry_date: '2026-10-29' }));
    expect(Object.keys(r.error!.fieldErrors!)).toEqual(['usage_type']);
  });
});

describe('supplier form', () => {
  it('upper-cases and checks GSTIN', () => {
    expect(parseForm(supplierSchema, fd({ name: 'X', gstin: '24aaaaa0000a1z5' })).data?.gstin).toBe('24AAAAA0000A1Z5');
    expect(parseForm(supplierSchema, fd({ name: 'X', gstin: '123' })).error?.fieldErrors?.gstin).toMatch(/15 characters/);
    expect(parseForm(supplierSchema, fd({ name: 'X', gstin: '' })).data?.gstin).toBeUndefined();
  });
});

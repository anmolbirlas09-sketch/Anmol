import { z } from 'zod';
import { L } from './labels';

// Form values arrive as strings. These helpers turn '' into undefined and
// check quantities the same way the database will (kg: 3 dp, m: 2 dp).

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const decimals = (s: string) => (s.includes('.') ? s.split('.')[1].length : 0);

function quantity(dp: number) {
  return z
    .string({ error: L.app.required })
    .trim()
    .min(1, L.app.required)
    .transform((s) => s.replace(/,/g, ''))
    .refine((s) => /^\d*\.?\d+$/.test(s), L.errors.number)
    .refine((s) => decimals(s) <= dp, L.errors.maxDecimals(dp))
    .transform(Number)
    .refine((n) => n > 0, L.errors.positive);
}

export const kg = () => quantity(3);
export const meters = () => quantity(2);

const optionalNumber = (opts: { int?: boolean; dp?: number } = {}) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((s) => s.replace(/,/g, ''))
      .refine((s) => /^\d*\.?\d+$/.test(s), L.errors.number)
      .refine((s) => !opts.int || !s.includes('.'), L.errors.number)
      .refine((s) => opts.dp === undefined || decimals(s) <= opts.dp, L.errors.maxDecimals(opts.dp ?? 0))
      .transform(Number)
      .optional(),
  );

const optionalText = () => z.preprocess(blankToUndefined, z.string().trim().max(500).optional());
const requiredText = (max = 100) => z.string({ error: L.app.required }).trim().min(1, L.app.required).max(max);
const uuid = () => z.string({ error: L.app.required }).uuid(L.app.required);
const optionalUuid = () => z.preprocess(blankToUndefined, z.string().uuid().optional());
const isoDate = () =>
  z
    .string({ error: L.app.required })
    .regex(/^\d{4}-\d{2}-\d{2}$/, L.errors.date)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), L.errors.date);

export const yarnLotSchema = z.object({
  lot_no: requiredText(50).transform((s) => s.toUpperCase()),
  yarn_quality_id: uuid(),
  supplier_id: optionalUuid(),
  factory_id: uuid(),
  inward_date: isoDate(),
  kgs_received: kg(),
  bags_count: optionalNumber({ int: true }),
  cones_count: optionalNumber({ int: true }),
  rate_per_kg: optionalNumber({ dp: 2 }),
  challan_no: optionalText(),
  notes: optionalText(),
});
export type YarnLotInput = z.infer<typeof yarnLotSchema>;

export const beamSchema = z.object({
  beam_no: requiredText(50).transform((s) => s.toUpperCase()),
  fabric_quality_id: uuid(),
  fabric_specification_id: uuid(),
  factory_id: uuid(),
  warp_length_m: meters(),
  created_date: isoDate(),
  notes: optionalText(),
});
export type BeamInput = z.infer<typeof beamSchema>;

export const consumptionSchema = z.object({
  beam_id: uuid(),
  yarn_lot_id: uuid(),
  usage_type: z.enum(['warp', 'weft'], { error: L.app.required }),
  kgs: kg(),
  entry_date: isoDate(),
});
export type ConsumptionInput = z.infer<typeof consumptionSchema>;

/** Day 8 am – 8 pm, night 8 pm – 8 am (see currentShift in format.ts). */
export const SHIFTS = ['day', 'night'] as const;

export const loadBeamSchema = z.object({
  beam_id: uuid(),
  loom_id: uuid(),
});

export const takeoffSchema = z.object({
  loom_id: uuid(),
  meters: meters(),
  kgs: kg(),
  entry_date: isoDate(),
  shift: z.preprocess(blankToUndefined, z.enum(SHIFTS).optional()),
  roll_no: z.preprocess(blankToUndefined, z.string().trim().max(50).optional()),
  notes: optionalText(),
  finish_beam: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});
export type TakeoffInput = z.infer<typeof takeoffSchema>;

/** Required number that may be 0 (e.g. wasted metres when nothing was wasted). */
function quantityOrZero(dp: number) {
  return z
    .string({ error: L.app.required })
    .trim()
    .min(1, L.app.required)
    .transform((s) => s.replace(/,/g, ''))
    .refine((s) => /^\d*\.?\d+$/.test(s), L.errors.number)
    .refine((s) => decimals(s) <= dp, L.errors.maxDecimals(dp))
    .transform(Number);
}

const optionalPositive = (dp: number) => optionalNumber({ dp }).refine((n) => n === undefined || n > 0, L.errors.positive);

/**
 * Metre-first production entry. Metres, wasted metres and roll length are
 * required; every weight is optional and stays undefined (NULL) when blank.
 */
export const productionSchema = z
  .object({
    loom_id: uuid(),
    fabric_quality_id: uuid(),
    fabric_specification_id: uuid(),
    meters: meters(),
    wasted_meters: quantityOrZero(2),
    roll_length_m: meters(),
    entry_date: isoDate(),
    shift: z.preprocess(blankToUndefined, z.enum(SHIFTS).optional()),
    gsm: optionalPositive(2),
    width_m: optionalPositive(3),
    weighed_kg: optionalPositive(3),
    warp_kg: optionalNumber({ dp: 3 }),
    weft_kg: optionalNumber({ dp: 3 }),
    waste_kg: optionalNumber({ dp: 3 }),
    waste_pct: optionalNumber({ dp: 2 }),
    notes: optionalText(),
    finish_beam: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
    client_ref: optionalUuid(),
  })
  .superRefine((v, ctx) => {
    if (v.wasted_meters > v.meters) {
      ctx.addIssue({ code: 'custom', path: ['wasted_meters'], message: L.production.wastedTooMuch });
    }
    const net = v.meters - Math.min(v.wasted_meters, v.meters);
    if (net > 0 && Math.ceil(net / v.roll_length_m) > 500) {
      ctx.addIssue({ code: 'custom', path: ['roll_length_m'], message: L.production.tooManyRolls });
    }
    if (v.waste_kg !== undefined && v.waste_pct !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['waste_pct'], message: L.production.wasteOneBasis });
    }
    if (v.waste_pct !== undefined && v.waste_pct > 100) {
      ctx.addIssue({ code: 'custom', path: ['waste_pct'], message: L.errors.between(0, 100) });
    }
    if (v.waste_kg !== undefined && v.warp_kg !== undefined && v.weft_kg !== undefined && v.waste_kg > v.warp_kg + v.weft_kg) {
      ctx.addIssue({ code: 'custom', path: ['waste_kg'], message: L.production.wasteMoreThanYarn });
    }
  });
export type ProductionInputForm = z.infer<typeof productionSchema>;

export const dispatchSchema = z.object({
  fabric_quality_id: uuid(),
  fabric_specification_id: uuid(),
  factory_id: uuid(),
  entry_date: isoDate(),
  meters: meters(),
  // Metre-first: kg is recorded when the fabric was weighed.
  kgs: optionalNumber({ dp: 3 }).refine((n) => n === undefined || n > 0, L.errors.positive),
  party: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
  challan_no: z.preprocess(blankToUndefined, z.string().trim().max(50).optional()),
  roll_refs: optionalText(),
  notes: optionalText(),
});
export type DispatchInput = z.infer<typeof dispatchSchema>;

/** Signed number: '-5', '+2.5', '3' (non-zero). */
function signedQuantity(dp: number, allowZero = false) {
  return z
    .string({ error: L.app.required })
    .trim()
    .min(1, L.app.required)
    .transform((s) => s.replace(/,/g, '').replace(/^\+/, ''))
    .refine((s) => /^-?\d*\.?\d+$/.test(s), L.errors.number)
    .refine((s) => decimals(s) <= dp, L.errors.maxDecimals(dp))
    .transform(Number)
    .refine((n) => allowZero || n !== 0, L.errors.nonZero);
}

export const yarnAdjustmentSchema = z.object({
  yarn_lot_id: uuid(),
  kgs: signedQuantity(3),
  reason: requiredText(200),
  entry_date: isoDate(),
});
export type YarnAdjustmentInput = z.infer<typeof yarnAdjustmentSchema>;

export const greyAdjustmentSchema = z
  .object({
    fabric_quality_id: uuid(),
    fabric_specification_id: uuid(),
    factory_id: uuid(),
    meters: signedQuantity(2, true),
    kgs: signedQuantity(3, true),
    reason: requiredText(200),
    entry_date: isoDate(),
  })
  .refine((v) => v.meters !== 0 || v.kgs !== 0, { message: L.errors.nonZero, path: ['meters'] });
export type GreyAdjustmentInput = z.infer<typeof greyAdjustmentSchema>;

export const ROLES = ['owner', 'supervisor', 'data_entry'] as const;

export const userSchema = z.object({
  id: uuid(),
  name: requiredText(),
  role: z.enum(ROLES),
  factory_id: optionalUuid(),
  active: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});

export const loomSchema = z.object({
  machine_no: requiredText(30).transform((s) => s.toUpperCase()),
  factory_id: uuid(),
  fabric_specification_id: optionalUuid(),
  sort_order: optionalNumber({ int: true }),
  status: z.enum(['idle', 'maintenance', 'running']).optional(),
  active: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
  notes: optionalText(),
});

export const factorySchema = z.object({
  code: requiredText(20).transform((s) => s.toUpperCase()),
  name: requiredText(),
  active: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});

export const settingsSchema = z.object({
  variance_threshold_pct: z
    .string({ error: L.app.required })
    .trim()
    .refine((s) => /^\d*\.?\d+$/.test(s), L.errors.number)
    .transform(Number)
    .refine((n) => n > 0 && n <= 100, L.errors.between(0, 100)),
});

/**
 * A specification of a parent fabric quality. Reed and ends per inch are two
 * separate, independent numbers — neither is ever calculated from the other.
 */
export const specificationSchema = z.object({
  fabric_quality_id: uuid(),
  reed: z
    .string({ error: L.app.required })
    .trim()
    .min(1, L.app.required)
    .refine((s) => /^\d*\.?\d+$/.test(s), L.errors.number)
    .refine((s) => decimals(s) <= 2, L.errors.maxDecimals(2))
    .transform(Number)
    .refine((n) => n > 0, L.errors.positive),
  ends_per_inch: z
    .string({ error: L.app.required })
    .trim()
    .min(1, L.app.required)
    .refine((s) => /^\d*\.?\d+$/.test(s), L.errors.number)
    .refine((s) => decimals(s) <= 2, L.errors.maxDecimals(2))
    .transform(Number)
    .refine((n) => n > 0, L.errors.positive),
  warp_yarn_quality_id: uuid(),
  weft_yarn_quality_id: uuid(),
  notes: optionalText(),
  active: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});
export type SpecificationForm = z.infer<typeof specificationSchema>;

export const yarnQualitySchema = z.object({
  name: requiredText(),
  denier: optionalNumber({ dp: 2 }),
  material: optionalText(),
  color: optionalText(),
  reorder_level_kg: z.preprocess((v) => blankToUndefined(v) ?? '0', z.string().transform(Number).pipe(z.number().min(0))),
  notes: optionalText(),
  active: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});

export const fabricQualitySchema = z.object({
  name: requiredText(),
  warp_yarn_quality_id: optionalUuid(),
  weft_yarn_quality_id: optionalUuid(),
  total_ends: optionalNumber({ int: true }),
  reed_width_m: optionalNumber({ dp: 3 }),
  picks_per_inch: optionalNumber({ dp: 2 }),
  warp_crimp_pct: z.preprocess((v) => blankToUndefined(v) ?? '0', z.string().transform(Number).pipe(z.number().min(0).max(100))),
  weft_wastage_pct: z.preprocess((v) => blankToUndefined(v) ?? '0', z.string().transform(Number).pipe(z.number().min(0).max(100))),
  gsm: optionalNumber({ dp: 2 }),
  notes: optionalText(),
  active: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});

export const supplierSchema = z.object({
  name: requiredText(),
  gstin: z.preprocess(
    (v) => (typeof v === 'string' ? blankToUndefined(v.trim().toUpperCase()) : v),
    z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/, L.errors.gstin).optional(),
  ),
  contact: optionalText(),
  phone: optionalText(),
  active: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});

// ---------------------------------------------------------------------------

export type FieldErrors = Record<string, string>;

export interface FormState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: FieldErrors;
  /** What the user typed, to refill the form after an error. */
  values?: Record<string, string>;
}

export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string' && !k.startsWith('$')) out[k] = v;
  return out;
}

/** Parse FormData with a schema; on failure return a FormState with per-field messages. */
export function parseForm<S extends z.ZodType>(
  schema: S,
  form: FormData,
): { data: z.infer<S>; error?: undefined } | { data?: undefined; error: FormState } {
  const values = formValues(form);
  const res = schema.safeParse(values);
  if (res.success) return { data: res.data };
  const flat = z.flattenError(res.error);
  const fieldErrors: FieldErrors = {};
  for (const [k, msgs] of Object.entries(flat.fieldErrors as Record<string, string[] | undefined>)) {
    if (msgs?.length) fieldErrors[k] = msgs[0];
  }
  return { error: { fieldErrors, values, error: flat.formErrors[0] } };
}

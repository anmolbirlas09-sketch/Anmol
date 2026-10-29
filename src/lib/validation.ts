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

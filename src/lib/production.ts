// Metre-first production calculations. The same formulas run in Postgres
// (generated columns on grey_fabric_production, split_rolls() in migration
// 0010); these copies give the entry form its live figures. The database values
// are the ones stored.
//
// Missing inputs give null — never 0 — so "not recorded" stays distinguishable
// from "zero".

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

export interface ProductionInput {
  /** Total loom production (m) */
  meters: number | null;
  /** Fabric wasted (m) */
  wastedMeters: number | null;
  rollLengthM?: number | null;
  gsm?: number | null;
  widthM?: number | null;
  /** Actual weighed fabric weight (kg) */
  weighedKg?: number | null;
  warpKg?: number | null;
  weftKg?: number | null;
  /** Actual measured waste (kg) */
  wasteKg?: number | null;
  /** Wastage % when only the percentage is known */
  wastePct?: number | null;
}

export interface ProductionFigures {
  netMeters: number | null;
  wastagePct: number | null;
  /** ESTIMATED fabric weight = GSM × width × metres / 1000 */
  estimatedKg: number | null;
  totalYarnKg: number | null;
  /** From ACTUAL measured waste kg ÷ total yarn kg */
  weightWastagePctActual: number | null;
  /** ESTIMATED waste kg from the entered % × total yarn kg */
  wasteKgEstimated: number | null;
  /** Roll metres from the usable fabric */
  rolls: number[];
  /** Whether the form should ask for KG wastage (any KG figure was entered) */
  asksForKgWastage: boolean;
}

/** Usable metres split into rolls of a standard length; the last roll takes the remainder. */
export function splitRolls(netMeters: number, rollLengthM: number): number[] {
  if (!(netMeters > 0) || !(rollLengthM > 0)) return [];
  // Work in centimetres so 0.1 + 0.2 style float errors cannot appear.
  const net = Math.round(netMeters * 100);
  const len = Math.round(rollLengthM * 100);
  const full = Math.floor(net / len);
  const rest = net - full * len;
  return [...Array(full).fill(len), ...(rest > 0 ? [rest] : [])].map((c) => c / 100);
}

export function productionFigures(i: ProductionInput): ProductionFigures {
  const meters = has(i.meters) && i.meters > 0 ? i.meters : null;
  const wasted = has(i.wastedMeters) && i.wastedMeters >= 0 ? i.wastedMeters : null;
  const valid = meters !== null && wasted !== null && wasted <= meters;
  const netMeters = valid ? round(meters - wasted, 2) : null;
  const wastagePct = valid ? round((wasted / meters) * 100, 2) : null;

  const estimatedKg = meters !== null && has(i.gsm) && i.gsm > 0 && has(i.widthM) && i.widthM > 0 ? round((i.gsm * i.widthM * meters) / 1000, 3) : null;
  const totalYarnKg = has(i.warpKg) && has(i.weftKg) ? round(i.warpKg + i.weftKg, 3) : null;
  const weightWastagePctActual = has(i.wasteKg) && totalYarnKg !== null && totalYarnKg > 0 ? round((i.wasteKg / totalYarnKg) * 100, 2) : null;
  const wasteKgEstimated = !has(i.wasteKg) && has(i.wastePct) && totalYarnKg !== null && totalYarnKg > 0 ? round((totalYarnKg * i.wastePct) / 100, 3) : null;

  return {
    netMeters,
    wastagePct,
    estimatedKg,
    totalYarnKg,
    weightWastagePctActual,
    wasteKgEstimated,
    rolls: netMeters !== null && has(i.rollLengthM) ? splitRolls(netMeters, i.rollLengthM) : [],
    asksForKgWastage: has(i.warpKg) || has(i.weftKg) || has(i.weighedKg),
  };
}

/** "6 × 100 m + 1 × 47 m" */
export function describeRolls(rolls: number[]): string {
  const groups = new Map<number, number>();
  for (const r of rolls) groups.set(r, (groups.get(r) ?? 0) + 1);
  return [...groups.entries()].map(([m, n]) => `${n} × ${m.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} m`).join(' + ');
}

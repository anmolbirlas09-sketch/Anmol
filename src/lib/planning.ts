// Same formulas as the SQL in migration 0003 (planned_warp_kg, planned_weft_kg,
// expected_fabric_length_m); used for live previews in forms. The database
// figures are the source of truth.

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const ok = (...v: (number | null | undefined)[]) => v.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0);

export function expectedFabricLength(warpLengthM: number, crimpPct = 0): number {
  return round(warpLengthM / (1 + crimpPct / 100), 2);
}

/** ends × warp length × denier ÷ 9,000,000 × (1 + crimp%) */
export function plannedWarpKg(p: { totalEnds?: number | null; warpLengthM?: number | null; denier?: number | null; crimpPct?: number | null }): number | null {
  if (!ok(p.totalEnds, p.warpLengthM, p.denier)) return null;
  return round((p.totalEnds! * p.warpLengthM! * p.denier!) / 9_000_000 * (1 + (p.crimpPct ?? 0) / 100), 3);
}

/** PPI × 39.37 × reed width × fabric length × denier ÷ 9,000,000 × (1 + wastage%) */
export function plannedWeftKg(p: {
  picksPerInch?: number | null; reedWidthM?: number | null; fabricLengthM?: number | null; denier?: number | null; wastagePct?: number | null;
}): number | null {
  if (!ok(p.picksPerInch, p.reedWidthM, p.fabricLengthM, p.denier)) return null;
  return round(
    (p.picksPerInch! * 39.37 * p.reedWidthM! * p.fabricLengthM! * p.denier!) / 9_000_000 * (1 + (p.wastagePct ?? 0) / 100),
    3,
  );
}

export function variancePct(actual: number | null | undefined, planned: number | null | undefined): number | null {
  if (actual == null || planned == null || planned === 0) return null;
  return round(((actual - planned) / planned) * 100, 2);
}

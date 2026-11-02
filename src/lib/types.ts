// Row shapes returned by the views and tables the app reads.
// Numeric columns arrive from PostgREST as JSON numbers.

export type Role = 'owner' | 'supervisor' | 'data_entry';
export type BeamStatus = 'prepared' | 'on_loom' | 'finished';
export type UsageType = 'warp' | 'weft';

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  factory_id: string | null;
  active: boolean;
}

export interface Factory {
  id: string;
  code: string;
  name: string;
}

export interface YarnQuality {
  id: string;
  name: string;
  denier: number | null;
  material: string | null;
  color: string | null;
  reorder_level_kg: number;
  active: boolean;
  notes: string | null;
}

export interface FabricQuality {
  id: string;
  name: string;
  warp_yarn_quality_id: string | null;
  weft_yarn_quality_id: string | null;
  total_ends: number | null;
  reed_width_m: number | null;
  picks_per_inch: number | null;
  warp_crimp_pct: number;
  weft_wastage_pct: number;
  gsm: number | null;
  active: boolean;
  notes: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  gstin: string | null;
  contact: string | null;
  phone: string | null;
  active: boolean;
}

export interface YarnLotBalance {
  yarn_lot_id: string;
  lot_no: string;
  inward_date: string;
  is_opening: boolean;
  yarn_quality_id: string;
  yarn_quality_name: string;
  denier: number | null;
  factory_id: string;
  factory_code: string;
  supplier_id: string | null;
  supplier_name: string | null;
  challan_no: string | null;
  rate_per_kg: number | null;
  kgs_received: number;
  warp_consumed_kg: number;
  weft_consumed_kg: number;
  adjusted_kg: number;
  balance_kg: number;
}

export interface YarnStockByQuality {
  yarn_quality_id: string;
  yarn_quality_name: string;
  reorder_level_kg: number;
  open_lot_count: number;
  balance_kg: number;
  is_low_stock: boolean;
}

export interface YarnLedgerRow {
  yarn_lot_id: string;
  entry_date: string;
  movement_type: 'inward' | 'opening' | 'warp' | 'weft' | 'adjustment';
  ref_id: string;
  beam_id: string | null;
  beam_no: string | null;
  kgs: number;
  reference: string | null;
  created_at: string;
}

export interface BeamSummary extends SpecFields {
  spec_warp_yarn_quality_id: string | null;
  spec_weft_yarn_quality_id: string | null;
  beam_id: string;
  /** The beam number, or CARD-n when none was entered */
  beam_no: string;
  status: BeamStatus;
  /** Beam making date */
  created_date: string | null;
  loaded_at: string | null;
  finished_at: string | null;
  factory_id: string | null;
  factory_code: string | null;
  loom_id: string | null;
  machine_no: string | null;
  fabric_quality_id: string | null;
  fabric_quality_name: string | null;
  /** Counter meter (warp length) */
  warp_length_m: number | null;
  expected_fabric_length_m: number | null;
  warp_kg: number;
  weft_kg: number;
  total_yarn_kg: number;
  planned_warp_kg: number | null;
  planned_weft_kg: number | null;
  warp_variance_pct: number | null;
  weft_variance_pct: number | null;
  variance_threshold_pct: number;
  warp_variance_flag: boolean;
  weft_variance_flag: boolean;
  /** Total production metres */
  grey_meters: number;
  wasted_meters: number;
  net_meters: number;
  /** Fabric wastage % by metres */
  wastage_pct: number | null;
  takeoff_count: number;
  roll_count: number;
  /** ACTUAL weighed fabric kg (null when nothing weighed) */
  grey_kg: number | null;
  weighed_count: number;
  /** ESTIMATED fabric kg from GSM × width (null when unknown) */
  estimated_kg: number | null;
  /** Yarn recorded at production (null when not recorded) */
  prod_warp_kg: number | null;
  prod_weft_kg: number | null;
  prod_total_yarn_kg: number | null;
  waste_kg_actual: number | null;
  waste_kg_estimated: number | null;
  weight_wastage_pct_actual: number | null;
  meters_per_kg: number | null;
  // Beam card
  card_no: number;
  /** What was typed as the beam number (null = none) */
  beam_no_entered: string | null;
  card_reed: number | null;
  card_warp_yarn_quality_id: string | null;
  card_weft_yarn_quality_id: string | null;
  total_ends: number | null;
  reed_space_in: number | null;
  picks_on_loom: number | null;
  rolling_meter: number | null;
  warp_weight_kg: number | null;
  gross_weight_kg: number | null;
  finished_weight_kg: number | null;
  weft_weight_kg: number | null;
  weave: string | null;
  getting_date: string | null;
  expected_finish_date: string | null;
  actual_finish_date: string | null;
  notes: string | null;
  /** Beam making date, or the day the card was created */
  register_date: string;
  created_at: string;
}

/** A load / unload / finish of a beam on a loom. */
export interface BeamLoomEvent {
  id: string;
  beam_id: string;
  beam_no: string;
  loom_id: string;
  machine_no: string;
  event: 'loaded' | 'unloaded' | 'finished';
  at: string;
  meters_so_far: number | null;
  created_by_name: string | null;
}


export interface ConsumptionLineView extends ConsumptionLine {
  fabric_specification_id: string;
  spec_code: string;
  beam_no: string;
  lot_no: string;
  yarn_quality_id: string;
  yarn_quality_name: string;
  created_by_name: string | null;
}

export interface FabricQualityView extends FabricQuality {
  spec_count: number;
  active_spec_count: number;
  warp_yarn_quality_name: string | null;
  weft_yarn_quality_name: string | null;
  warp_denier: number | null;
  weft_denier: number | null;
}

export interface ConsumptionLine {
  id: string;
  beam_id: string;
  yarn_lot_id: string;
  usage_type: UsageType;
  kgs: number;
  entry_date: string;
  created_at: string;
  created_by: string | null;
}

export type LoomStatus = 'idle' | 'running' | 'maintenance';

export interface LoomStatusRow {
  loom_id: string;
  machine_no: string;
  status: LoomStatus;
  active: boolean;
  sort_order: number;
  factory_id: string;
  factory_code: string;
  beam_id: string | null;
  beam_no: string | null;
  loaded_at: string | null;
  fabric_quality_id: string | null;
  fabric_quality_name: string | null;
  warp_length_m: number | null;
  warp_kg: number | null;
  weft_kg: number | null;
  meters_on_beam: number | null;
  kgs_on_beam: number | null;
  expected_fabric_length_m: number | null;
  total_yarn_kg: number | null;
  wasted_on_beam: number | null;
  net_on_beam: number | null;
  /** Specification running now (from the beam) */
  fabric_specification_id: string | null;
  spec_code: string | null;
  reed: number | null;
  ends_per_inch: number | null;
  warp_yarn_quality_name: string | null;
  weft_yarn_quality_name: string | null;
  /** Specification the loom is set up for (null = any) */
  assigned_specification_id: string | null;
  assigned_spec_code: string | null;
  /** The loom's last counter meter reading */
  last_counter_reading: number | null;
  last_reading_at: string | null;
  last_reading_date: string | null;
  last_reading_time: string | null;
  expected_finish_date: string | null;
  total_ends: number | null;
  picks_on_loom: number | null;
  reed_space_in: number | null;
}

export interface Takeoff extends SpecFields {
  id: string;
  entry_date: string;
  shift: string | null;
  /** Total production metres (null for a counter reading with nothing to compare against) */
  meters: number | null;
  /** ACTUAL weighed kg, null when not weighed */
  kgs: number | null;
  roll_no: string | null;
  notes: string | null;
  created_at: string;
  meters_per_kg: number | null;
  beam_id: string;
  beam_no: string;
  beam_status: BeamStatus;
  loom_id: string;
  machine_no: string;
  factory_id: string;
  factory_code: string;
  fabric_quality_id: string | null;
  fabric_quality_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  wasted_meters: number;
  net_meters: number | null;
  wastage_pct: number | null;
  roll_length_m: number | null;
  gsm: number | null;
  width_m: number | null;
  estimated_kg: number | null;
  warp_kg: number | null;
  weft_kg: number | null;
  total_yarn_kg: number | null;
  waste_kg: number | null;
  waste_pct_entered: number | null;
  waste_kg_estimated: number | null;
  weight_wastage_pct: number | null;
  roll_count: number;
  /** Actual time of the reading, 'HH:MM:SS' */
  production_time: string | null;
  counter_reading: number | null;
  previous_reading: number | null;
  meters_source: 'manual' | 'counter' | null;
  counter_reset: boolean;
  /** Date + time of the reading (IST wall clock) */
  reading_at: string;
}

export interface FabricRoll extends Pick<SpecFields, 'fabric_specification_id' | 'spec_code' | 'reed' | 'ends_per_inch'> {
  id: string;
  roll_no: string;
  seq: number;
  meters: number;
  production_id: string;
  entry_date: string;
  shift: string | null;
  beam_id: string;
  beam_no: string;
  loom_id: string;
  machine_no: string;
  factory_id: string;
  factory_code: string;
  fabric_quality_id: string;
  fabric_quality_name: string;
}

export interface GreyStockRow extends SpecFields {
  /** null: production on beams whose quality is not filled in yet */
  fabric_quality_id: string | null;
  fabric_quality_name: string | null;
  factory_id: string;
  factory_code: string;
  produced_m: number;
  produced_kg: number;
  dispatched_m: number;
  dispatched_kg: number;
  adjusted_m: number;
  adjusted_kg: number;
  stock_m: number;
  stock_kg: number;
  /** Take-offs without a weighed kg: kg stock is then incomplete */
  unweighed_count: number;
}

export interface ProductionDaily extends Pick<SpecFields, 'fabric_specification_id' | 'spec_code'> {
  entry_date: string;
  factory_id: string;
  factory_code: string;
  loom_id: string;
  machine_no: string;
  fabric_quality_id: string;
  fabric_quality_name: string;
  takeoff_count: number;
  /** Total production metres */
  meters: number;
  /** ACTUAL weighed kg (null when none weighed) */
  kgs: number | null;
  wasted_meters: number;
  net_meters: number;
  estimated_kg: number | null;
  warp_kg: number | null;
  weft_kg: number | null;
  total_yarn_kg: number | null;
  waste_kg: number | null;
  waste_kg_estimated: number | null;
}

export interface YarnStockByQualityFactory {
  yarn_quality_id: string;
  yarn_quality_name: string;
  factory_id: string;
  factory_code: string;
  lot_count: number;
  balance_kg: number;
}

export interface Dispatch extends Pick<SpecFields, 'fabric_specification_id' | 'spec_code'> {
  id: string;
  entry_date: string;
  meters: number;
  kgs: number | null;
  roll_refs: string | null;
  party: string | null;
  challan_no: string | null;
  notes: string | null;
  created_at: string;
  fabric_quality_id: string;
  fabric_quality_name: string;
  factory_id: string;
  factory_code: string;
  created_by_name: string | null;
}

export interface LoomRow {
  id: string;
  factory_id: string;
  machine_no: string;
  fabric_specification_id: string | null;
  status: LoomStatus;
  active: boolean;
  sort_order: number;
  notes: string | null;
}

/** A specification of a parent fabric quality. Reed and ends per inch are independent. */
export interface FabricSpecification {
  id: string;
  fabric_quality_id: string;
  fabric_quality_name: string;
  seq: number;
  /** System-generated Specification ID, e.g. QUALITY101-S2 */
  spec_code: string;
  reed: number | null;
  ends_per_inch: number | null;
  warp_yarn_quality_id: string | null;
  warp_yarn_quality_name: string | null;
  warp_denier: number | null;
  weft_yarn_quality_id: string | null;
  weft_yarn_quality_name: string | null;
  weft_denier: number | null;
  active: boolean;
  notes: string | null;
  quality_active: boolean;
  beam_count: number;
  /** Has beams/production: reed, ends per inch and yarns are locked */
  has_history: boolean;
}

/** Fields every row carrying a specification exposes. */
export interface SpecFields {
  /** null while the beam card's specification is not filled in */
  fabric_specification_id: string | null;
  spec_code: string | null;
  reed: number | null;
  ends_per_inch: number | null;
  warp_yarn_quality_name: string | null;
  weft_yarn_quality_name: string | null;
}

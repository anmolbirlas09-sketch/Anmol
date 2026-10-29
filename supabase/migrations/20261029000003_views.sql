-- =============================================================================
-- 0003 · Stock views (all balances are computed from the ledgers)
--
-- All views are security_invoker so the caller's row-level security applies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Planning formulas (§4). Return null when any input is missing.
-- ---------------------------------------------------------------------------

-- Warp kg = ends × warp length (m) × denier ÷ 9,000,000 × (1 + crimp%)
create or replace function public.planned_warp_kg(p_total_ends numeric, p_warp_length_m numeric,
                                                  p_denier numeric, p_crimp_pct numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(p_total_ends * p_warp_length_m * p_denier / 9000000.0 * (1 + coalesce(p_crimp_pct, 0) / 100.0), 3)
$$;

-- Weft kg = PPI × 39.37 × reed width (m) × fabric length (m) × denier ÷ 9,000,000 × (1 + wastage%)
create or replace function public.planned_weft_kg(p_picks_per_inch numeric, p_reed_width_m numeric,
                                                  p_fabric_length_m numeric, p_denier numeric, p_wastage_pct numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(p_picks_per_inch * 39.37 * p_reed_width_m * p_fabric_length_m * p_denier / 9000000.0
               * (1 + coalesce(p_wastage_pct, 0) / 100.0), 3)
$$;

-- Fabric length expected from a beam: warp length ÷ (1 + crimp%).
create or replace function public.expected_fabric_length_m(p_warp_length_m numeric, p_crimp_pct numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(p_warp_length_m / (1 + coalesce(p_crimp_pct, 0) / 100.0), 2)
$$;

create or replace function public.variance_pct(p_actual numeric, p_planned numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_planned is null or p_planned = 0 or p_actual is null then null
              else round((p_actual - p_planned) / p_planned * 100, 2) end
$$;

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::numeric from public.app_settings s where s.key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------------
-- Yarn
-- ---------------------------------------------------------------------------

-- Every yarn movement, one row each. kgs is signed (+ in, − out).
create view public.v_yarn_ledger with (security_invoker = true) as
  select l.id as yarn_lot_id, l.lot_no, l.yarn_quality_id, l.factory_id,
         l.inward_date as entry_date,
         case when l.is_opening then 'opening' else 'inward' end as movement_type,
         l.id as ref_id, null::uuid as beam_id, null::text as beam_no,
         l.kgs_received as kgs, l.challan_no as reference, l.created_at
  from public.yarn_lots l
  union all
  select c.yarn_lot_id, l.lot_no, l.yarn_quality_id, l.factory_id,
         c.entry_date, c.usage_type::text, c.id, c.beam_id, b.beam_no,
         -c.kgs, null, c.created_at
  from public.yarn_consumption c
  join public.yarn_lots l on l.id = c.yarn_lot_id
  join public.beams b on b.id = c.beam_id
  union all
  select a.yarn_lot_id, l.lot_no, l.yarn_quality_id, l.factory_id,
         a.entry_date, 'adjustment', a.id, null, null,
         a.kgs, a.reason, a.created_at
  from public.stock_adjustments a
  join public.yarn_lots l on l.id = a.yarn_lot_id
  where a.item_type = 'yarn_lot';

-- Balance per lot.
create view public.v_yarn_lot_balance with (security_invoker = true) as
  select l.id as yarn_lot_id, l.lot_no, l.inward_date, l.is_opening,
         l.yarn_quality_id, q.name as yarn_quality_name, q.denier,
         l.factory_id, f.code as factory_code,
         l.supplier_id, s.name as supplier_name, l.challan_no, l.rate_per_kg,
         l.kgs_received,
         coalesce(c.warp_kg, 0)  as warp_consumed_kg,
         coalesce(c.weft_kg, 0)  as weft_consumed_kg,
         coalesce(a.adj_kg, 0)   as adjusted_kg,
         l.kgs_received - coalesce(c.warp_kg, 0) - coalesce(c.weft_kg, 0) + coalesce(a.adj_kg, 0) as balance_kg
  from public.yarn_lots l
  join public.yarn_qualities q on q.id = l.yarn_quality_id
  join public.factories f on f.id = l.factory_id
  left join public.suppliers s on s.id = l.supplier_id
  left join lateral (
    select sum(kgs) filter (where usage_type = 'warp') as warp_kg,
           sum(kgs) filter (where usage_type = 'weft') as weft_kg
    from public.yarn_consumption where yarn_lot_id = l.id
  ) c on true
  left join lateral (
    select sum(kgs) as adj_kg from public.stock_adjustments
    where item_type = 'yarn_lot' and yarn_lot_id = l.id
  ) a on true;

-- Balance per yarn quality per factory (factory = where the lot was received).
create view public.v_yarn_stock_by_quality_factory with (security_invoker = true) as
  select q.id as yarn_quality_id, q.name as yarn_quality_name,
         f.id as factory_id, f.code as factory_code,
         count(b.yarn_lot_id) as lot_count,
         coalesce(sum(b.kgs_received), 0) as received_kg,
         coalesce(sum(b.warp_consumed_kg + b.weft_consumed_kg), 0) as consumed_kg,
         coalesce(sum(b.adjusted_kg), 0) as adjusted_kg,
         coalesce(sum(b.balance_kg), 0) as balance_kg
  from public.v_yarn_lot_balance b
  join public.yarn_qualities q on q.id = b.yarn_quality_id
  join public.factories f on f.id = b.factory_id
  group by q.id, q.name, f.id, f.code;

-- Balance per yarn quality across all factories, with low-stock flag.
create view public.v_yarn_stock_by_quality with (security_invoker = true) as
  select q.id as yarn_quality_id, q.name as yarn_quality_name, q.denier, q.color, q.material,
         q.reorder_level_kg,
         count(b.yarn_lot_id) filter (where b.balance_kg > 0) as open_lot_count,
         coalesce(sum(b.kgs_received), 0) as received_kg,
         coalesce(sum(b.warp_consumed_kg + b.weft_consumed_kg), 0) as consumed_kg,
         coalesce(sum(b.adjusted_kg), 0) as adjusted_kg,
         coalesce(sum(b.balance_kg), 0) as balance_kg,
         coalesce(sum(b.balance_kg), 0) < q.reorder_level_kg as is_low_stock
  from public.yarn_qualities q
  left join public.v_yarn_lot_balance b on b.yarn_quality_id = q.id
  where q.active or b.yarn_lot_id is not null
  group by q.id;

-- ---------------------------------------------------------------------------
-- Beams: planned vs actual, yield
-- ---------------------------------------------------------------------------
create view public.v_beam_summary with (security_invoker = true) as
  select b.id as beam_id, b.beam_no, b.status, b.created_date, b.loaded_at, b.finished_at,
         b.factory_id, f.code as factory_code,
         b.loom_id, lm.machine_no,
         b.fabric_quality_id, fq.name as fabric_quality_name,
         b.warp_length_m,
         public.expected_fabric_length_m(b.warp_length_m, fq.warp_crimp_pct) as expected_fabric_length_m,
         coalesce(c.warp_kg, 0) as warp_kg,
         coalesce(c.weft_kg, 0) as weft_kg,
         coalesce(c.warp_kg, 0) + coalesce(c.weft_kg, 0) as total_yarn_kg,
         p.planned_warp_kg,
         p.planned_weft_kg,
         public.variance_pct(c.warp_kg, p.planned_warp_kg) as warp_variance_pct,
         public.variance_pct(c.weft_kg, p.planned_weft_kg) as weft_variance_pct,
         t.threshold as variance_threshold_pct,
         coalesce(abs(public.variance_pct(c.warp_kg, p.planned_warp_kg)) > t.threshold, false) as warp_variance_flag,
         coalesce(abs(public.variance_pct(c.weft_kg, p.planned_weft_kg)) > t.threshold, false) as weft_variance_flag,
         coalesce(g.meters, 0) as grey_meters,
         coalesce(g.kgs, 0) as grey_kg,
         coalesce(g.takeoffs, 0) as takeoff_count,
         coalesce(c.warp_kg, 0) + coalesce(c.weft_kg, 0) - coalesce(g.kgs, 0) as wastage_kg,
         case when coalesce(c.warp_kg, 0) + coalesce(c.weft_kg, 0) > 0
              then round((coalesce(c.warp_kg, 0) + coalesce(c.weft_kg, 0) - coalesce(g.kgs, 0))
                         / (coalesce(c.warp_kg, 0) + coalesce(c.weft_kg, 0)) * 100, 2)
         end as wastage_pct,
         case when coalesce(g.kgs, 0) > 0 then round(g.meters / g.kgs, 3) end as meters_per_kg
  from public.beams b
  join public.factories f on f.id = b.factory_id
  join public.fabric_qualities fq on fq.id = b.fabric_quality_id
  left join public.yarn_qualities wq on wq.id = fq.warp_yarn_quality_id
  left join public.yarn_qualities fy on fy.id = fq.weft_yarn_quality_id
  left join public.looms lm on lm.id = b.loom_id
  left join lateral (
    select sum(kgs) filter (where usage_type = 'warp') as warp_kg,
           sum(kgs) filter (where usage_type = 'weft') as weft_kg
    from public.yarn_consumption where beam_id = b.id
  ) c on true
  left join lateral (
    select sum(meters) as meters, sum(kgs) as kgs, count(*) as takeoffs
    from public.grey_fabric_production where beam_id = b.id
  ) g on true
  cross join lateral (
    select public.planned_warp_kg(fq.total_ends, b.warp_length_m, wq.denier, fq.warp_crimp_pct) as planned_warp_kg,
           public.planned_weft_kg(fq.picks_per_inch, fq.reed_width_m,
                                  public.expected_fabric_length_m(b.warp_length_m, fq.warp_crimp_pct),
                                  fy.denier, fq.weft_wastage_pct) as planned_weft_kg
  ) p
  cross join lateral (select public.setting_numeric('variance_threshold_pct', 5) as threshold) t;

-- ---------------------------------------------------------------------------
-- Grey fabric
-- ---------------------------------------------------------------------------

-- Every grey movement, one row each. meters/kgs are signed (+ in, − out).
create view public.v_grey_ledger with (security_invoker = true) as
  select b.fabric_quality_id, lm.factory_id, p.entry_date, 'production' as movement_type,
         p.id as ref_id, p.beam_id, p.loom_id, p.roll_no as reference,
         p.meters, p.kgs, p.created_at
  from public.grey_fabric_production p
  join public.beams b on b.id = p.beam_id
  join public.looms lm on lm.id = p.loom_id
  union all
  select d.fabric_quality_id, d.factory_id, d.entry_date, 'dispatch',
         d.id, null, null, coalesce(d.challan_no, d.party),
         -d.meters, -d.kgs, d.created_at
  from public.grey_fabric_dispatch d
  union all
  select a.fabric_quality_id, a.factory_id, a.entry_date,
         case when a.is_opening then 'opening' else 'adjustment' end,
         a.id, null, null, a.reason,
         a.meters, a.kgs, a.created_at
  from public.stock_adjustments a
  where a.item_type = 'grey_fabric';

-- Grey stock per fabric quality per factory.
create view public.v_grey_stock with (security_invoker = true) as
  select g.fabric_quality_id, fq.name as fabric_quality_name,
         g.factory_id, f.code as factory_code,
         coalesce(sum(g.meters) filter (where g.movement_type = 'production'), 0)            as produced_m,
         coalesce(sum(g.kgs)    filter (where g.movement_type = 'production'), 0)            as produced_kg,
         coalesce(-sum(g.meters) filter (where g.movement_type = 'dispatch'), 0)             as dispatched_m,
         coalesce(-sum(g.kgs)    filter (where g.movement_type = 'dispatch'), 0)             as dispatched_kg,
         coalesce(sum(g.meters) filter (where g.movement_type in ('opening', 'adjustment')), 0) as adjusted_m,
         coalesce(sum(g.kgs)    filter (where g.movement_type in ('opening', 'adjustment')), 0) as adjusted_kg,
         sum(g.meters) as stock_m,
         sum(g.kgs)    as stock_kg
  from public.v_grey_ledger g
  join public.fabric_qualities fq on fq.id = g.fabric_quality_id
  join public.factories f on f.id = g.factory_id
  group by g.fabric_quality_id, fq.name, g.factory_id, f.code;

-- Grey stock per fabric quality, all factories.
create view public.v_grey_stock_by_quality with (security_invoker = true) as
  select fabric_quality_id, fabric_quality_name,
         sum(produced_m) as produced_m, sum(produced_kg) as produced_kg,
         sum(dispatched_m) as dispatched_m, sum(dispatched_kg) as dispatched_kg,
         sum(adjusted_m) as adjusted_m, sum(adjusted_kg) as adjusted_kg,
         sum(stock_m) as stock_m, sum(stock_kg) as stock_kg
  from public.v_grey_stock
  group by fabric_quality_id, fabric_quality_name;

-- ---------------------------------------------------------------------------
-- Looms: what is running where
-- ---------------------------------------------------------------------------
create view public.v_loom_status with (security_invoker = true) as
  select lm.id as loom_id, lm.machine_no, lm.status, lm.active, lm.sort_order,
         lm.factory_id, f.code as factory_code,
         bs.beam_id, bs.beam_no, bs.loaded_at,
         bs.fabric_quality_id, bs.fabric_quality_name,
         bs.warp_length_m,
         bs.warp_kg, bs.weft_kg,
         bs.grey_meters as meters_on_beam,
         bs.grey_kg as kgs_on_beam
  from public.looms lm
  join public.factories f on f.id = lm.factory_id
  left join public.beams b on b.loom_id = lm.id and b.status = 'on_loom'
  left join public.v_beam_summary bs on bs.beam_id = b.id;

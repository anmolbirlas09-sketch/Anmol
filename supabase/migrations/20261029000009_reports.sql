-- =============================================================================
-- 0009 · Report functions (phase 5)
--
-- All are SECURITY INVOKER: they read the views as the caller, so row-level
-- security decides what each person's report contains. Aggregation happens
-- here so reports are not cut off by the API's max-rows limit.
-- Opening = movements before p_from; closing = movements up to p_to.
-- =============================================================================

-- Yarn stock movement by quality (factory = where the lot was received).
create or replace function public.report_yarn_by_quality(p_from date, p_to date, p_factory_id uuid default null)
returns table (
  yarn_quality_id uuid, yarn_quality_name text,
  opening_kg numeric, inward_kg numeric, warp_kg numeric, weft_kg numeric, adjusted_kg numeric, closing_kg numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select q.id, q.name,
         coalesce(sum(l.kgs) filter (where l.entry_date < p_from), 0),
         coalesce(sum(l.kgs) filter (where l.entry_date between p_from and p_to and l.movement_type in ('inward', 'opening')), 0),
         coalesce(-sum(l.kgs) filter (where l.entry_date between p_from and p_to and l.movement_type = 'warp'), 0),
         coalesce(-sum(l.kgs) filter (where l.entry_date between p_from and p_to and l.movement_type = 'weft'), 0),
         coalesce(sum(l.kgs) filter (where l.entry_date between p_from and p_to and l.movement_type = 'adjustment'), 0),
         coalesce(sum(l.kgs) filter (where l.entry_date <= p_to), 0)
  from public.v_yarn_ledger l
  join public.yarn_qualities q on q.id = l.yarn_quality_id
  where p_factory_id is null or l.factory_id = p_factory_id
  group by q.id, q.name
  having bool_or(l.entry_date <= p_to)
  order by q.name
$$;

-- Same, per lot (lots with any stock or movement in the period).
create or replace function public.report_yarn_by_lot(p_from date, p_to date, p_factory_id uuid default null)
returns table (
  yarn_lot_id uuid, lot_no text, inward_date date, yarn_quality_name text, factory_code text,
  opening_kg numeric, inward_kg numeric, warp_kg numeric, weft_kg numeric, adjusted_kg numeric, closing_kg numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.yarn_lot_id, l.lot_no, min(yl.inward_date), q.name, f.code,
         coalesce(sum(l.kgs) filter (where l.entry_date < p_from), 0),
         coalesce(sum(l.kgs) filter (where l.entry_date between p_from and p_to and l.movement_type in ('inward', 'opening')), 0),
         coalesce(-sum(l.kgs) filter (where l.entry_date between p_from and p_to and l.movement_type = 'warp'), 0),
         coalesce(-sum(l.kgs) filter (where l.entry_date between p_from and p_to and l.movement_type = 'weft'), 0),
         coalesce(sum(l.kgs) filter (where l.entry_date between p_from and p_to and l.movement_type = 'adjustment'), 0),
         coalesce(sum(l.kgs) filter (where l.entry_date <= p_to), 0)
  from public.v_yarn_ledger l
  join public.yarn_lots yl on yl.id = l.yarn_lot_id
  join public.yarn_qualities q on q.id = l.yarn_quality_id
  join public.factories f on f.id = l.factory_id
  where p_factory_id is null or l.factory_id = p_factory_id
  group by l.yarn_lot_id, l.lot_no, q.name, f.code
  having coalesce(sum(l.kgs) filter (where l.entry_date <= p_to), 0) <> 0
      or bool_or(l.entry_date between p_from and p_to)
  order by min(yl.inward_date), l.lot_no
$$;

-- Grey stock movement by fabric quality and factory.
create or replace function public.report_grey_summary(p_from date, p_to date, p_factory_id uuid default null)
returns table (
  fabric_quality_id uuid, fabric_quality_name text, factory_id uuid, factory_code text,
  opening_m numeric, opening_kg numeric, produced_m numeric, produced_kg numeric,
  dispatched_m numeric, dispatched_kg numeric, adjusted_m numeric, adjusted_kg numeric,
  closing_m numeric, closing_kg numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.fabric_quality_id, fq.name, g.factory_id, f.code,
         coalesce(sum(g.meters) filter (where g.entry_date < p_from), 0),
         coalesce(sum(g.kgs)    filter (where g.entry_date < p_from), 0),
         coalesce(sum(g.meters) filter (where g.entry_date between p_from and p_to and g.movement_type = 'production'), 0),
         coalesce(sum(g.kgs)    filter (where g.entry_date between p_from and p_to and g.movement_type = 'production'), 0),
         coalesce(-sum(g.meters) filter (where g.entry_date between p_from and p_to and g.movement_type = 'dispatch'), 0),
         coalesce(-sum(g.kgs)    filter (where g.entry_date between p_from and p_to and g.movement_type = 'dispatch'), 0),
         coalesce(sum(g.meters) filter (where g.entry_date between p_from and p_to and g.movement_type in ('opening', 'adjustment')), 0),
         coalesce(sum(g.kgs)    filter (where g.entry_date between p_from and p_to and g.movement_type in ('opening', 'adjustment')), 0),
         coalesce(sum(g.meters) filter (where g.entry_date <= p_to), 0),
         coalesce(sum(g.kgs)    filter (where g.entry_date <= p_to), 0)
  from public.v_grey_ledger g
  join public.fabric_qualities fq on fq.id = g.fabric_quality_id
  join public.factories f on f.id = g.factory_id
  where p_factory_id is null or g.factory_id = p_factory_id
  group by g.fabric_quality_id, fq.name, g.factory_id, f.code
  having bool_or(g.entry_date <= p_to)
  order by fq.name, f.code desc
$$;

-- Loom-wise production per day or per month.
create or replace function public.report_loom_production(p_from date, p_to date, p_factory_id uuid default null, p_period text default 'day')
returns table (
  period date, factory_code text, machine_no text, fabric_quality_name text,
  takeoff_count bigint, meters numeric, kgs numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p_period = 'month' then date_trunc('month', d.entry_date)::date else d.entry_date end,
         d.factory_code, d.machine_no, d.fabric_quality_name,
         sum(d.takeoff_count)::bigint, sum(d.meters), sum(d.kgs)
  from public.v_production_daily d
  where d.entry_date between p_from and p_to
    and (p_factory_id is null or d.factory_id = p_factory_id)
  group by 1, d.factory_code, d.machine_no, d.fabric_quality_name
  order by 1, d.factory_code desc, d.machine_no, d.fabric_quality_name
$$;

grant execute on function public.report_yarn_by_quality(date, date, uuid),
                          public.report_yarn_by_lot(date, date, uuid),
                          public.report_grey_summary(date, date, uuid),
                          public.report_loom_production(date, date, uuid, text)
  to authenticated;

-- Dispatches with names, for the dispatch screen.
create view public.v_dispatches with (security_invoker = true) as
  select d.id, d.entry_date, d.meters, d.kgs, d.roll_refs, d.party, d.challan_no, d.notes, d.created_at,
         d.fabric_quality_id, fq.name as fabric_quality_name,
         d.factory_id, f.code as factory_code,
         d.created_by, u.name as created_by_name
  from public.grey_fabric_dispatch d
  join public.fabric_qualities fq on fq.id = d.fabric_quality_id
  join public.factories f on f.id = d.factory_id
  left join public.app_users u on u.id = d.created_by;

grant select on public.v_dispatches to authenticated;

-- =============================================================================
-- 0010 · Metre-first production with independent metre and KG wastage
--
-- What changes
--   * A production entry (grey_fabric_production) is now metre-first:
--       meters          total loom production (m)            — required
--       wasted_meters   fabric wasted (m)                     — required (0 allowed)
--       net_meters      usable fabric = meters − wasted       — generated
--       wastage_pct     wasted / meters × 100                 — generated
--       roll_length_m   standard roll length; rolls are created from the net metres
--       kgs             ACTUAL weighed fabric weight          — now optional
--       gsm, width_m    optional; estimated_kg = gsm × width × meters / 1000 (generated)
--       warp_kg/weft_kg optional yarn consumed for this production (information only:
--                       yarn STOCK still moves through beam yarn lines)
--       waste_kg        actual measured waste in kg           — optional
--       waste_pct_entered  wastage % when only the % is known — optional
--     KG wastage is never derived from "yarn − fabric weight".
--   * fabric_rolls: one row per roll; Σ roll metres = net metres (checked at commit).
--   * Grey stock counts NET usable metres. KG stock is only enforced when every
--     take-off of that quality/factory was weighed.
--   * Dispatch kg becomes optional (metre-first).
--   * record_production() RPC: one call per production entry, idempotent via client_ref.
--
-- Existing rows are kept: wasted_meters = 0 (so net = meters, stock unchanged),
-- fabric_quality_id is copied from the beam, kgs stays as recorded.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Production entry columns
-- ---------------------------------------------------------------------------
alter table public.grey_fabric_production
  add column fabric_quality_id uuid references public.fabric_qualities (id),
  add column wasted_meters     numeric(14,2) not null default 0,
  add column roll_length_m     numeric(14,2),
  add column gsm               numeric(8,2),
  add column width_m           numeric(8,3),
  add column warp_kg           numeric(14,3),
  add column weft_kg           numeric(14,3),
  add column waste_kg          numeric(14,3),
  add column waste_pct_entered numeric(6,2),
  add column client_ref        uuid;

-- Weighed weight is optional now.
alter table public.grey_fabric_production alter column kgs drop not null;
alter table public.grey_fabric_production drop constraint grey_fabric_production_kgs_check;

alter table public.grey_fabric_production
  add constraint grey_fabric_production_kgs_check           check (kgs is null or kgs > 0),
  add constraint grey_fabric_production_wasted_check        check (wasted_meters >= 0 and wasted_meters <= meters),
  add constraint grey_fabric_production_roll_length_check   check (roll_length_m is null or roll_length_m > 0),
  add constraint grey_fabric_production_gsm_check           check (gsm is null or gsm > 0),
  add constraint grey_fabric_production_width_check         check (width_m is null or width_m > 0),
  add constraint grey_fabric_production_warp_kg_check       check (warp_kg is null or warp_kg >= 0),
  add constraint grey_fabric_production_weft_kg_check       check (weft_kg is null or weft_kg >= 0),
  add constraint grey_fabric_production_waste_kg_check      check (waste_kg is null or waste_kg >= 0),
  add constraint grey_fabric_production_waste_pct_check     check (waste_pct_entered is null or (waste_pct_entered >= 0 and waste_pct_entered <= 100)),
  -- Either the measured waste kg or a %, not both.
  add constraint grey_fabric_production_waste_one_basis     check (waste_kg is null or waste_pct_entered is null),
  -- Measured waste cannot exceed the yarn consumed, when both are known.
  add constraint grey_fabric_production_waste_le_yarn       check (waste_kg is null or warp_kg is null or weft_kg is null or waste_kg <= warp_kg + weft_kg);

-- Derived values (NULL whenever an input is missing — never treated as 0).
alter table public.grey_fabric_production
  add column net_meters  numeric(14,2) generated always as (meters - wasted_meters) stored,
  add column wastage_pct numeric(6,2)  generated always as (round(wasted_meters / meters * 100, 2)) stored,
  add column estimated_kg numeric(14,3) generated always as (round(gsm * width_m * meters / 1000, 3)) stored,
  add column total_yarn_kg numeric(14,3) generated always as (warp_kg + weft_kg) stored,
  add column weight_wastage_pct numeric(6,2) generated always as (
    case when waste_kg is not null and warp_kg + weft_kg > 0 then round(waste_kg / (warp_kg + weft_kg) * 100, 2) end
  ) stored,
  add column waste_kg_estimated numeric(14,3) generated always as (
    case when waste_kg is null and waste_pct_entered is not null and warp_kg + weft_kg > 0
         then round((warp_kg + weft_kg) * waste_pct_entered / 100, 3) end
  ) stored;

comment on column public.grey_fabric_production.meters is 'Total loom production (m)';
comment on column public.grey_fabric_production.kgs is 'ACTUAL weighed fabric weight (kg); NULL when not weighed';
comment on column public.grey_fabric_production.estimated_kg is 'ESTIMATED fabric weight = GSM × width (m) × metres / 1000; NULL without GSM and width';
comment on column public.grey_fabric_production.warp_kg is 'Warp yarn consumed for this production (information; yarn stock moves via beam yarn lines)';
comment on column public.grey_fabric_production.waste_kg is 'ACTUAL measured fabric waste (kg)';
comment on column public.grey_fabric_production.waste_kg_estimated is 'ESTIMATED waste kg from the entered % × total yarn kg';
comment on column public.grey_fabric_production.client_ref is 'Idempotency key from the entry form: the same submission is stored once';

-- Backfill quality from the beam, then require it.
update public.grey_fabric_production p
   set fabric_quality_id = b.fabric_quality_id
  from public.beams b
 where b.id = p.beam_id and p.fabric_quality_id is null;
alter table public.grey_fabric_production alter column fabric_quality_id set not null;

create unique index grey_production_client_ref_key on public.grey_fabric_production (client_ref) where client_ref is not null;
create index grey_production_quality_idx on public.grey_fabric_production (fabric_quality_id);

-- ---------------------------------------------------------------------------
-- Rolls
-- ---------------------------------------------------------------------------
create table public.fabric_rolls (
  id             uuid primary key default gen_random_uuid(),
  production_id  uuid not null references public.grey_fabric_production (id) on delete cascade,
  seq            integer not null check (seq > 0),
  roll_no        text not null,
  meters         numeric(14,2) not null check (meters > 0),
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);
create unique index fabric_rolls_roll_no_key on public.fabric_rolls (lower(roll_no));
create index fabric_rolls_production_idx on public.fabric_rolls (production_id);

create trigger fabric_rolls_row_meta before insert or update on public.fabric_rolls
  for each row execute function public.set_row_meta();
create trigger fabric_rolls_audit after insert or update or delete on public.fabric_rolls
  for each row execute function public.write_audit_log('id');

alter table public.fabric_rolls enable row level security;
grant select on public.fabric_rolls to authenticated;
-- Visible when the production entry is visible (same factory rules); written only by record_production().
create policy fabric_rolls_select on public.fabric_rolls for select to authenticated
  using (exists (select 1 from public.grey_fabric_production p where p.id = production_id));

-- Σ roll metres must equal the entry's net metres (only for entries made with rolls).
create or replace function public.assert_rolls_reconcile(p_production_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_net numeric;
  v_len numeric;
  v_sum numeric;
begin
  select net_meters, roll_length_m into v_net, v_len from public.grey_fabric_production where id = p_production_id;
  if not found or v_len is null then
    return;
  end if;
  select coalesce(sum(meters), 0) into v_sum from public.fabric_rolls where production_id = p_production_id;
  if v_sum <> v_net then
    raise exception 'Roll total % m does not match usable production % m', v_sum, v_net
      using errcode = 'WV004';
  end if;
end;
$$;

create or replace function public.trg_rolls_reconcile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'fabric_rolls' then
    perform public.assert_rolls_reconcile(coalesce(new.production_id, old.production_id));
  elsif tg_op = 'UPDATE' then
    perform public.assert_rolls_reconcile(new.id);
  end if;
  return null;
end;
$$;

create constraint trigger fabric_rolls_reconcile
  after insert or update or delete on public.fabric_rolls
  deferrable initially deferred
  for each row execute function public.trg_rolls_reconcile();

create constraint trigger grey_production_rolls_reconcile
  after update of meters, wasted_meters, roll_length_m on public.grey_fabric_production
  deferrable initially deferred
  for each row execute function public.trg_rolls_reconcile();

-- Split usable metres into rolls of a standard length; the last roll takes the remainder.
-- Kept identical to splitRolls() in src/lib/production.ts.
create or replace function public.split_rolls(p_net numeric, p_roll_length numeric)
returns setof numeric
language sql
immutable
set search_path = ''
as $$
  select case when g < full_rolls then p_roll_length else p_net - p_roll_length * full_rolls end
  from (select floor(p_net / p_roll_length)::int as full_rolls) f,
       generate_series(0, f.full_rolls - case when p_net - p_roll_length * f.full_rolls > 0 then 0 else 1 end) g
  where p_net > 0
$$;

-- ---------------------------------------------------------------------------
-- Production before-trigger: quality comes from (and must match) the beam
-- ---------------------------------------------------------------------------
create or replace function public.trg_grey_production_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_beam public.beams;
  v_quality text;
begin
  select * into v_beam from public.beams where id = new.beam_id;

  if new.fabric_quality_id is null then
    new.fabric_quality_id := v_beam.fabric_quality_id;
  elsif new.fabric_quality_id <> v_beam.fabric_quality_id then
    select name into v_quality from public.fabric_qualities where id = v_beam.fabric_quality_id;
    raise exception 'Beam % is weaving %, not the fabric quality selected', v_beam.beam_no, v_quality
      using errcode = 'WV004';
  end if;

  if tg_op = 'UPDATE' and new.beam_id = old.beam_id and new.loom_id = old.loom_id then
    return new;   -- quantity / date corrections on an existing entry
  end if;
  if new.loom_id is null then
    new.loom_id := v_beam.loom_id;
  end if;
  if v_beam.status <> 'on_loom' then
    raise exception 'Beam % is not running on a loom (status: %)', v_beam.beam_no, v_beam.status using errcode = 'WV004';
  end if;
  if new.loom_id <> v_beam.loom_id then
    raise exception 'Beam % is running on a different loom', v_beam.beam_no using errcode = 'WV004';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dispatch: kg optional (metre-first)
-- ---------------------------------------------------------------------------
alter table public.grey_fabric_dispatch alter column kgs drop not null;
alter table public.grey_fabric_dispatch drop constraint grey_fabric_dispatch_kgs_check;
alter table public.grey_fabric_dispatch add constraint grey_fabric_dispatch_kgs_check check (kgs is null or kgs > 0);

-- ---------------------------------------------------------------------------
-- Grey stock: net usable metres; kg only enforced when fully weighed
-- ---------------------------------------------------------------------------
create or replace function public.grey_stock_balance(p_fabric_quality_id uuid, p_factory_id uuid,
                                                     out meters numeric, out kgs numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.meters), 0), coalesce(sum(m.kgs), 0)
  from (
    select p.net_meters as meters, p.kgs
    from public.grey_fabric_production p
    join public.looms l on l.id = p.loom_id
    where p.fabric_quality_id = p_fabric_quality_id and l.factory_id = p_factory_id
    union all
    select -d.meters, -d.kgs
    from public.grey_fabric_dispatch d
    where d.fabric_quality_id = p_fabric_quality_id and d.factory_id = p_factory_id
    union all
    select a.meters, a.kgs
    from public.stock_adjustments a
    where a.item_type = 'grey_fabric' and a.fabric_quality_id = p_fabric_quality_id and a.factory_id = p_factory_id
  ) m
$$;

-- Number of take-offs without a weighed kg for a quality at a factory.
create or replace function public.grey_unweighed_count(p_fabric_quality_id uuid, p_factory_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.grey_fabric_production p
  join public.looms l on l.id = p.loom_id
  where p.fabric_quality_id = p_fabric_quality_id and l.factory_id = p_factory_id and p.kgs is null
$$;

create or replace function public.assert_grey_stock_not_negative(p_fabric_quality_id uuid, p_factory_id uuid,
                                                                  p_requested_m numeric, p_requested_kg numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bal record;
  v_quality text;
  v_factory text;
  v_kg_known boolean;
  v_avail text;
begin
  if p_fabric_quality_id is null or p_factory_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grey:' || p_fabric_quality_id::text || ':' || p_factory_id::text, 0));
  select * into v_bal from public.grey_stock_balance(p_fabric_quality_id, p_factory_id);
  v_kg_known := public.grey_unweighed_count(p_fabric_quality_id, p_factory_id) = 0;
  if v_bal.meters < 0 or (v_kg_known and v_bal.kgs < 0) then
    select name into v_quality from public.fabric_qualities where id = p_fabric_quality_id;
    select code into v_factory from public.factories where id = p_factory_id;
    v_avail := to_char(v_bal.meters + coalesce(p_requested_m, 0), 'FM999999990.00') || ' m'
            || case when v_kg_known then ' / ' || to_char(v_bal.kgs + coalesce(p_requested_kg, 0), 'FM999999990.000') || ' kg' else '' end;
    raise exception 'Not enough grey stock of % at %: % available', v_quality, v_factory, v_avail
      using errcode = 'WV003',
            detail = json_build_object(
              'fabric_quality', v_quality, 'factory', v_factory,
              'available_m', round(v_bal.meters + coalesce(p_requested_m, 0), 2),
              'available_kg', case when v_kg_known then round(v_bal.kgs + coalesce(p_requested_kg, 0), 3) end,
              'requested_m', round(coalesce(p_requested_m, 0), 2), 'requested_kg', round(coalesce(p_requested_kg, 0), 3))::text;
  end if;
end;
$$;

create or replace function public.trg_grey_dispatch_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_grey_stock_not_negative(new.fabric_quality_id, new.factory_id, new.meters, coalesce(new.kgs, 0));
  elsif tg_op = 'UPDATE' then
    if (new.fabric_quality_id, new.factory_id) = (old.fabric_quality_id, old.factory_id) then
      perform public.assert_grey_stock_not_negative(new.fabric_quality_id, new.factory_id,
                                                    greatest(new.meters - old.meters, 0), greatest(coalesce(new.kgs, 0) - coalesce(old.kgs, 0), 0));
    else
      perform public.assert_grey_stock_not_negative(new.fabric_quality_id, new.factory_id, new.meters, coalesce(new.kgs, 0));
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.trg_grey_production_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factory uuid;
begin
  select l.factory_id into v_factory from public.looms l where l.id = old.loom_id;
  perform public.assert_grey_stock_not_negative(old.fabric_quality_id, v_factory, 0, 0);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views (same names; production now counts net usable metres into stock)
-- ---------------------------------------------------------------------------
create or replace view public.v_grey_ledger with (security_invoker = true) as
  select p.fabric_quality_id, lm.factory_id, p.entry_date, 'production' as movement_type,
         p.id as ref_id, p.beam_id, p.loom_id, p.roll_no as reference,
         p.net_meters as meters, p.kgs, p.created_at
  from public.grey_fabric_production p
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

-- + unweighed_count: take-offs without a weighed kg (kg stock is then incomplete).
create or replace view public.v_grey_stock with (security_invoker = true) as
  select g.fabric_quality_id, fq.name as fabric_quality_name,
         g.factory_id, f.code as factory_code,
         coalesce(sum(g.meters) filter (where g.movement_type = 'production'), 0)            as produced_m,
         coalesce(sum(g.kgs)    filter (where g.movement_type = 'production'), 0)            as produced_kg,
         coalesce(-sum(g.meters) filter (where g.movement_type = 'dispatch'), 0)             as dispatched_m,
         coalesce(-sum(g.kgs)    filter (where g.movement_type = 'dispatch'), 0)             as dispatched_kg,
         coalesce(sum(g.meters) filter (where g.movement_type in ('opening', 'adjustment')), 0) as adjusted_m,
         coalesce(sum(g.kgs)    filter (where g.movement_type in ('opening', 'adjustment')), 0) as adjusted_kg,
         sum(g.meters) as stock_m,
         coalesce(sum(g.kgs), 0) as stock_kg,
         count(*) filter (where g.movement_type = 'production' and g.kgs is null) as unweighed_count
  from public.v_grey_ledger g
  join public.fabric_qualities fq on fq.id = g.fabric_quality_id
  join public.factories f on f.id = g.factory_id
  group by g.fabric_quality_id, fq.name, g.factory_id, f.code;

create or replace view public.v_grey_stock_by_quality with (security_invoker = true) as
  select fabric_quality_id, fabric_quality_name,
         sum(produced_m) as produced_m, sum(produced_kg) as produced_kg,
         sum(dispatched_m) as dispatched_m, sum(dispatched_kg) as dispatched_kg,
         sum(adjusted_m) as adjusted_m, sum(adjusted_kg) as adjusted_kg,
         sum(stock_m) as stock_m, sum(stock_kg) as stock_kg,
         sum(unweighed_count) as unweighed_count
  from public.v_grey_stock
  group by fabric_quality_id, fabric_quality_name;

-- Beam summary: the old "wastage = yarn − grey kg" is removed (it is not wastage).
drop view public.v_loom_status;
drop view public.v_beam_summary;

create view public.v_beam_summary with (security_invoker = true) as
  select b.id as beam_id, b.beam_no, b.status, b.created_date, b.loaded_at, b.finished_at,
         b.factory_id, f.code as factory_code,
         b.loom_id, lm.machine_no,
         b.fabric_quality_id, fq.name as fabric_quality_name,
         b.warp_length_m,
         public.expected_fabric_length_m(b.warp_length_m, fq.warp_crimp_pct) as expected_fabric_length_m,
         -- Yarn ISSUED to the beam from stock (lots)
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
         -- Production (metres first)
         coalesce(g.meters, 0) as grey_meters,
         coalesce(g.wasted, 0) as wasted_meters,
         coalesce(g.net, 0) as net_meters,
         case when coalesce(g.meters, 0) > 0 then round(g.wasted / g.meters * 100, 2) end as wastage_pct,
         coalesce(g.takeoffs, 0) as takeoff_count,
         coalesce(g.rolls, 0) as roll_count,
         -- Weights: NULL when nothing was recorded (never 0 by default)
         g.weighed_kg as grey_kg,
         g.weighed_count,
         g.estimated_kg,
         g.prod_warp_kg,
         g.prod_weft_kg,
         g.prod_total_yarn_kg,
         g.waste_kg_actual,
         g.waste_kg_estimated,
         case when g.waste_kg_actual is not null and g.yarn_for_actual > 0
              then round(g.waste_kg_actual / g.yarn_for_actual * 100, 2) end as weight_wastage_pct_actual,
         case when g.weighed_kg > 0 then round(g.weighed_meters / g.weighed_kg, 3) end as meters_per_kg
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
    select sum(x.meters) as meters, sum(x.wasted_meters) as wasted, sum(x.net_meters) as net,
           count(*) as takeoffs,
           (select count(*) from public.fabric_rolls r join public.grey_fabric_production q on q.id = r.production_id where q.beam_id = b.id) as rolls,
           sum(x.kgs) as weighed_kg,
           count(x.kgs) as weighed_count,
           sum(x.meters) filter (where x.kgs is not null) as weighed_meters,
           sum(x.estimated_kg) as estimated_kg,
           sum(x.warp_kg) as prod_warp_kg,
           sum(x.weft_kg) as prod_weft_kg,
           sum(x.total_yarn_kg) as prod_total_yarn_kg,
           sum(x.waste_kg) as waste_kg_actual,
           sum(x.waste_kg_estimated) as waste_kg_estimated,
           sum(x.total_yarn_kg) filter (where x.waste_kg is not null) as yarn_for_actual
    from public.grey_fabric_production x where x.beam_id = b.id
  ) g on true
  cross join lateral (
    select public.planned_warp_kg(fq.total_ends, b.warp_length_m, wq.denier, fq.warp_crimp_pct) as planned_warp_kg,
           public.planned_weft_kg(fq.picks_per_inch, fq.reed_width_m,
                                  public.expected_fabric_length_m(b.warp_length_m, fq.warp_crimp_pct),
                                  fy.denier, fq.weft_wastage_pct) as planned_weft_kg
  ) p
  cross join lateral (select public.setting_numeric('variance_threshold_pct', 5) as threshold) t;

create view public.v_loom_status with (security_invoker = true) as
  select lm.id as loom_id, lm.machine_no, lm.status, lm.active, lm.sort_order,
         lm.factory_id, f.code as factory_code,
         bs.beam_id, bs.beam_no, bs.loaded_at,
         bs.fabric_quality_id, bs.fabric_quality_name,
         bs.warp_length_m,
         bs.warp_kg, bs.weft_kg,
         bs.grey_meters as meters_on_beam,
         bs.grey_kg as kgs_on_beam,
         bs.expected_fabric_length_m,
         bs.total_yarn_kg,
         bs.wasted_meters as wasted_on_beam,
         bs.net_meters as net_on_beam
  from public.looms lm
  join public.factories f on f.id = lm.factory_id
  left join public.beams b on b.loom_id = lm.id and b.status = 'on_loom'
  left join public.v_beam_summary bs on bs.beam_id = b.id;

-- Production entries with names (appended columns).
create or replace view public.v_takeoffs with (security_invoker = true) as
  select p.id, p.entry_date, p.shift, p.meters, p.kgs, p.roll_no, p.notes, p.created_at,
         case when p.kgs > 0 then round(p.meters / p.kgs, 3) end as meters_per_kg,
         p.beam_id, b.beam_no, b.status as beam_status,
         p.loom_id, lm.machine_no, lm.factory_id, f.code as factory_code,
         p.fabric_quality_id, fq.name as fabric_quality_name,
         p.created_by, u.name as created_by_name,
         p.wasted_meters, p.net_meters, p.wastage_pct, p.roll_length_m,
         p.gsm, p.width_m, p.estimated_kg,
         p.warp_kg, p.weft_kg, p.total_yarn_kg,
         p.waste_kg, p.waste_pct_entered, p.waste_kg_estimated, p.weight_wastage_pct,
         (select count(*) from public.fabric_rolls r where r.production_id = p.id) as roll_count
  from public.grey_fabric_production p
  join public.beams b on b.id = p.beam_id
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  join public.fabric_qualities fq on fq.id = p.fabric_quality_id
  left join public.app_users u on u.id = p.created_by;

-- Daily production per loom (appended columns).
create or replace view public.v_production_daily with (security_invoker = true) as
  select p.entry_date, lm.factory_id, f.code as factory_code,
         p.loom_id, lm.machine_no,
         p.fabric_quality_id, fq.name as fabric_quality_name,
         count(*) as takeoff_count,
         sum(p.meters) as meters,
         sum(p.kgs) as kgs,
         sum(p.wasted_meters) as wasted_meters,
         sum(p.net_meters) as net_meters,
         sum(p.estimated_kg) as estimated_kg,
         sum(p.warp_kg) as warp_kg,
         sum(p.weft_kg) as weft_kg,
         sum(p.total_yarn_kg) as total_yarn_kg,
         sum(p.waste_kg) as waste_kg,
         sum(p.waste_kg_estimated) as waste_kg_estimated
  from public.grey_fabric_production p
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  join public.fabric_qualities fq on fq.id = p.fabric_quality_id
  group by p.entry_date, lm.factory_id, f.code, p.loom_id, lm.machine_no, p.fabric_quality_id, fq.name;

-- Roll tracking.
create view public.v_fabric_rolls with (security_invoker = true) as
  select r.id, r.roll_no, r.seq, r.meters, r.created_at,
         p.id as production_id, p.entry_date, p.shift,
         p.beam_id, b.beam_no, p.loom_id, lm.machine_no, lm.factory_id, f.code as factory_code,
         p.fabric_quality_id, fq.name as fabric_quality_name
  from public.fabric_rolls r
  join public.grey_fabric_production p on p.id = r.production_id
  join public.beams b on b.id = p.beam_id
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  join public.fabric_qualities fq on fq.id = p.fabric_quality_id;

grant select on public.v_beam_summary, public.v_loom_status, public.v_fabric_rolls to authenticated;

-- Loom-wise production report: metres first, KG where recorded, with filters.
drop function public.report_loom_production(date, date, uuid, text);
create function public.report_loom_production(
  p_from date, p_to date, p_factory_id uuid default null, p_period text default 'day',
  p_loom_id uuid default null, p_fabric_quality_id uuid default null, p_beam_no text default null)
returns table (
  period date, factory_code text, machine_no text, fabric_quality_name text,
  takeoff_count bigint, meters numeric, wasted_meters numeric, net_meters numeric, wastage_pct numeric,
  estimated_kg numeric, kgs numeric, warp_kg numeric, weft_kg numeric, total_yarn_kg numeric,
  waste_kg numeric, waste_kg_estimated numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p_period = 'month' then date_trunc('month', t.entry_date)::date else t.entry_date end,
         t.factory_code, t.machine_no, t.fabric_quality_name,
         count(*)::bigint, sum(t.meters), sum(t.wasted_meters), sum(t.net_meters),
         round(sum(t.wasted_meters) / nullif(sum(t.meters), 0) * 100, 2),
         sum(t.estimated_kg), sum(t.kgs), sum(t.warp_kg), sum(t.weft_kg), sum(t.total_yarn_kg),
         sum(t.waste_kg), sum(t.waste_kg_estimated)
  from public.v_takeoffs t
  where t.entry_date between p_from and p_to
    and (p_factory_id is null or t.factory_id = p_factory_id)
    and (p_loom_id is null or t.loom_id = p_loom_id)
    and (p_fabric_quality_id is null or t.fabric_quality_id = p_fabric_quality_id)
    and (p_beam_no is null or lower(t.beam_no) = lower(p_beam_no))
  group by 1, t.factory_code, t.machine_no, t.fabric_quality_name
  order by 1, t.factory_code desc, t.machine_no, t.fabric_quality_name
$$;
grant execute on function public.report_loom_production(date, date, uuid, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- record_production(): one production entry, its rolls, optional beam finish
-- ---------------------------------------------------------------------------
create or replace function public.record_production(
  p_loom_id           uuid,
  p_fabric_quality_id uuid,
  p_meters            numeric,
  p_wasted_meters     numeric,
  p_roll_length_m     numeric,
  p_entry_date        date default null,
  p_shift             text default null,
  p_gsm               numeric default null,
  p_width_m           numeric default null,
  p_weighed_kg        numeric default null,
  p_warp_kg           numeric default null,
  p_weft_kg           numeric default null,
  p_waste_kg          numeric default null,
  p_waste_pct         numeric default null,
  p_notes             text default null,
  p_finish_beam       boolean default false,
  p_client_ref        uuid default null
)
returns public.grey_fabric_production
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loom public.looms;
  v_beam_id uuid;
  v_row public.grey_fabric_production;
  v_date date := coalesce(p_entry_date, public.ist_today());
  v_seq int;
  v_len numeric;
  v_count int;
begin
  -- Same submission twice (double tap, retry): return the first one.
  if p_client_ref is not null then
    select * into v_row from public.grey_fabric_production where client_ref = p_client_ref;
    if found then
      return v_row;
    end if;
  end if;

  select * into v_loom from public.looms where id = p_loom_id for update;  -- serialises roll numbering per loom
  if not found then
    raise exception 'Loom not found' using errcode = 'WV002';
  end if;
  perform public.require_factory_access(v_loom.factory_id);
  select id into v_beam_id from public.beams where loom_id = p_loom_id and status = 'on_loom' for update;
  if not found then
    raise exception 'Loom % has no beam running', v_loom.machine_no using errcode = 'WV004';
  end if;

  if p_meters is null or p_meters <= 0 then
    raise exception 'Production metres must be more than 0' using errcode = 'WV004';
  end if;
  if p_wasted_meters is null or p_wasted_meters < 0 then
    raise exception 'Enter the wasted metres (0 if none)' using errcode = 'WV004';
  end if;
  if p_wasted_meters > p_meters then
    raise exception 'Wasted metres (%) cannot be more than production metres (%)', p_wasted_meters, p_meters using errcode = 'WV004';
  end if;
  if p_roll_length_m is null or p_roll_length_m <= 0 then
    raise exception 'Roll length must be more than 0' using errcode = 'WV004';
  end if;
  if ceil((p_meters - p_wasted_meters) / p_roll_length_m) > 500 then
    raise exception 'That would make more than 500 rolls; check the roll length' using errcode = 'WV004';
  end if;

  insert into public.grey_fabric_production (
    beam_id, loom_id, fabric_quality_id, entry_date, shift, meters, wasted_meters, roll_length_m,
    gsm, width_m, kgs, warp_kg, weft_kg, waste_kg, waste_pct_entered, notes, client_ref)
  values (
    v_beam_id, p_loom_id, p_fabric_quality_id, v_date, p_shift, p_meters, p_wasted_meters, p_roll_length_m,
    p_gsm, p_width_m, p_weighed_kg, p_warp_kg, p_weft_kg, p_waste_kg, p_waste_pct, p_notes, p_client_ref)
  returning * into v_row;

  -- Rolls from the usable metres: <loom>-<YYMMDD>-<nn>, numbered per loom per day.
  select coalesce(max(r.seq), 0) into v_seq
  from public.fabric_rolls r
  join public.grey_fabric_production q on q.id = r.production_id
  where q.loom_id = p_loom_id and q.entry_date = v_date;
  v_count := 0;
  for v_len in select * from public.split_rolls(v_row.net_meters, p_roll_length_m) loop
    v_count := v_count + 1;
    insert into public.fabric_rolls (production_id, seq, roll_no, meters)
    values (v_row.id, v_seq + v_count,
            v_loom.machine_no || '-' || to_char(v_date, 'YYMMDD') || '-' || lpad((v_seq + v_count)::text, 2, '0'),
            v_len);
  end loop;

  if p_finish_beam then
    perform public.finish_beam(v_beam_id);
  end if;
  return v_row;
end;
$$;

grant execute on function public.record_production(uuid, uuid, numeric, numeric, numeric, date, text, numeric, numeric,
                                                   numeric, numeric, numeric, numeric, numeric, text, boolean, uuid)
  to authenticated;
grant execute on function public.split_rolls(numeric, numeric), public.grey_unweighed_count(uuid, uuid) to authenticated;

-- =============================================================================
-- Weaving unit: yarn → beam → loom → grey fabric
-- 0001 · Core schema (tables, enums, row metadata, audit log)
--
-- Conventions
--   * Every quantity lives in a ledger row; balances are never stored.
--   * kg  → numeric(14,3)   meters → numeric(14,2)
--   * Business dates default to "today in Asia/Kolkata".
--   * Every table has created_at / created_by / updated_at / updated_by,
--     maintained by public.set_row_meta(); every change is copied to
--     public.audit_log by public.write_audit_log().
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.loom_status        as enum ('idle', 'running', 'maintenance');
create type public.beam_status        as enum ('prepared', 'on_loom', 'finished');
create type public.yarn_usage_type    as enum ('warp', 'weft');
create type public.user_role          as enum ('owner', 'supervisor', 'data_entry');
create type public.adjustment_item    as enum ('yarn_lot', 'grey_fabric');

-- Business "today" for Asia/Kolkata, used as the default for every entry date.
create or replace function public.ist_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- ---------------------------------------------------------------------------
-- Generic row metadata trigger: created_* on insert, updated_* on update.
-- created_by cannot be spoofed by an authenticated caller.
-- ---------------------------------------------------------------------------
create or replace function public.set_row_meta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_at := new.created_at;
    new.updated_by := new.created_by;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users (profile for each Supabase auth user)
-- ---------------------------------------------------------------------------
create table public.factories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint factories_code_not_blank check (btrim(code) <> '')
);
create unique index factories_code_key on public.factories (lower(code));

create table public.app_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  role        public.user_role not null default 'data_entry',
  factory_id  uuid references public.factories (id),   -- null = all factories
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
comment on column public.app_users.factory_id is 'null = user works across all factories';

-- ---------------------------------------------------------------------------
-- Masters
-- ---------------------------------------------------------------------------
create table public.looms (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references public.factories (id),
  machine_no  text not null,
  status      public.loom_status not null default 'idle',
  active      boolean not null default true,
  sort_order  integer not null default 0,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint looms_machine_no_not_blank check (btrim(machine_no) <> '')
);
create unique index looms_machine_no_key on public.looms (lower(machine_no));
create index looms_factory_idx on public.looms (factory_id, sort_order);

create table public.yarn_qualities (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  denier           numeric(10,2) check (denier is null or denier > 0),
  material         text,
  color            text,
  reorder_level_kg numeric(14,3) not null default 0 check (reorder_level_kg >= 0),
  active           boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint yarn_qualities_name_not_blank check (btrim(name) <> '')
);
create unique index yarn_qualities_name_key on public.yarn_qualities (lower(name));
comment on column public.yarn_qualities.reorder_level_kg is 'Dashboard shows a low-stock warning when balance falls below this';

create table public.fabric_qualities (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  warp_yarn_quality_id  uuid references public.yarn_qualities (id),
  weft_yarn_quality_id  uuid references public.yarn_qualities (id),
  total_ends            integer       check (total_ends is null or total_ends > 0),
  reed_width_m          numeric(8,3)  check (reed_width_m is null or reed_width_m > 0),
  picks_per_inch        numeric(8,2)  check (picks_per_inch is null or picks_per_inch > 0),
  warp_crimp_pct        numeric(6,2)  not null default 0 check (warp_crimp_pct >= 0),
  weft_wastage_pct      numeric(6,2)  not null default 0 check (weft_wastage_pct >= 0),
  gsm                   numeric(8,2)  check (gsm is null or gsm > 0),
  active                boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  constraint fabric_qualities_name_not_blank check (btrim(name) <> '')
);
create unique index fabric_qualities_name_key on public.fabric_qualities (lower(name));

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  gstin       text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  contact     text,
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint suppliers_name_not_blank check (btrim(name) <> '')
);
create unique index suppliers_name_key on public.suppliers (lower(name));

-- Key/value settings, e.g. variance_threshold_pct.
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ---------------------------------------------------------------------------
-- Yarn inward (one row per lot)
-- ---------------------------------------------------------------------------
create table public.yarn_lots (
  id               uuid primary key default gen_random_uuid(),
  lot_no           text not null,
  yarn_quality_id  uuid not null references public.yarn_qualities (id),
  supplier_id      uuid references public.suppliers (id),
  factory_id       uuid not null references public.factories (id),
  inward_date      date not null default public.ist_today(),
  kgs_received     numeric(14,3) not null check (kgs_received > 0),
  bags_count       integer check (bags_count is null or bags_count >= 0),
  cones_count      integer check (cones_count is null or cones_count >= 0),
  rate_per_kg      numeric(12,2) check (rate_per_kg is null or rate_per_kg >= 0),
  challan_no       text,
  is_opening       boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint yarn_lots_lot_no_not_blank check (btrim(lot_no) <> '')
);
create unique index yarn_lots_lot_no_key on public.yarn_lots (lower(lot_no));
create index yarn_lots_quality_idx on public.yarn_lots (yarn_quality_id);
create index yarn_lots_factory_idx on public.yarn_lots (factory_id);
comment on column public.yarn_lots.is_opening is 'true when imported as opening stock';

-- ---------------------------------------------------------------------------
-- Beams
-- ---------------------------------------------------------------------------
create table public.beams (
  id                 uuid primary key default gen_random_uuid(),
  beam_no            text not null,
  fabric_quality_id  uuid not null references public.fabric_qualities (id),
  factory_id         uuid not null references public.factories (id),
  warp_length_m      numeric(14,2) not null check (warp_length_m > 0),
  created_date       date not null default public.ist_today(),
  status             public.beam_status not null default 'prepared',
  loom_id            uuid references public.looms (id),
  loaded_at          timestamptz,
  finished_at        timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint beams_beam_no_not_blank check (btrim(beam_no) <> ''),
  -- state machine invariants
  constraint beams_state_consistent check (
       (status = 'prepared' and loom_id is null     and loaded_at is null and finished_at is null)
    or (status = 'on_loom'  and loom_id is not null and loaded_at is not null and finished_at is null)
    or (status = 'finished' and finished_at is not null)
  )
);
create unique index beams_beam_no_key on public.beams (lower(beam_no));
-- THE rule: a loom holds at most one active beam (race-proof backstop).
create unique index beams_one_active_per_loom on public.beams (loom_id) where status = 'on_loom';
create index beams_fabric_quality_idx on public.beams (fabric_quality_id);
create index beams_factory_idx on public.beams (factory_id);
comment on column public.beams.factory_id is 'Where the beam currently is; set to the loom''s factory when loaded';

-- ---------------------------------------------------------------------------
-- Yarn consumption: many rows per beam (several warp lots, several weft lots)
-- ---------------------------------------------------------------------------
create table public.yarn_consumption (
  id           uuid primary key default gen_random_uuid(),
  beam_id      uuid not null references public.beams (id) on delete restrict,
  yarn_lot_id  uuid not null references public.yarn_lots (id) on delete restrict,
  usage_type   public.yarn_usage_type not null,
  kgs          numeric(14,3) not null check (kgs > 0),
  entry_date   date not null default public.ist_today(),
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
create index yarn_consumption_beam_idx on public.yarn_consumption (beam_id);
create index yarn_consumption_lot_idx  on public.yarn_consumption (yarn_lot_id);

-- ---------------------------------------------------------------------------
-- Grey fabric production (take-off from a loom)
-- ---------------------------------------------------------------------------
create table public.grey_fabric_production (
  id           uuid primary key default gen_random_uuid(),
  beam_id      uuid not null references public.beams (id) on delete restrict,
  loom_id      uuid not null references public.looms (id) on delete restrict,
  entry_date   date not null default public.ist_today(),
  shift        text check (shift is null or shift in ('day', 'night', 'A', 'B', 'C')),
  meters       numeric(14,2) not null check (meters > 0),
  kgs          numeric(14,3) not null check (kgs > 0),
  roll_no      text,
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
create index grey_production_beam_idx on public.grey_fabric_production (beam_id);
create index grey_production_loom_idx on public.grey_fabric_production (loom_id, entry_date);
create index grey_production_date_idx on public.grey_fabric_production (entry_date);

-- ---------------------------------------------------------------------------
-- Grey fabric dispatch (outward)
-- ---------------------------------------------------------------------------
create table public.grey_fabric_dispatch (
  id                 uuid primary key default gen_random_uuid(),
  fabric_quality_id  uuid not null references public.fabric_qualities (id),
  factory_id         uuid not null references public.factories (id),
  entry_date         date not null default public.ist_today(),
  meters             numeric(14,2) not null check (meters > 0),
  kgs                numeric(14,3) not null check (kgs > 0),
  roll_refs          text,
  party              text,
  challan_no         text,
  notes              text,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
create index grey_dispatch_quality_idx on public.grey_fabric_dispatch (fabric_quality_id, factory_id);
create index grey_dispatch_date_idx on public.grey_fabric_dispatch (entry_date);

-- ---------------------------------------------------------------------------
-- Stock adjustments (signed). Also used for opening grey stock.
-- ---------------------------------------------------------------------------
create table public.stock_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  item_type          public.adjustment_item not null,
  yarn_lot_id        uuid references public.yarn_lots (id) on delete restrict,
  fabric_quality_id  uuid references public.fabric_qualities (id),
  factory_id         uuid not null references public.factories (id),
  entry_date         date not null default public.ist_today(),
  kgs                numeric(14,3) not null default 0,
  meters             numeric(14,2) not null default 0,
  reason             text not null check (btrim(reason) <> ''),
  is_opening         boolean not null default false,
  approved_by        uuid references public.app_users (id),
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint stock_adjustments_target check (
       (item_type = 'yarn_lot'    and yarn_lot_id is not null and fabric_quality_id is null and meters = 0 and kgs <> 0)
    or (item_type = 'grey_fabric' and fabric_quality_id is not null and yarn_lot_id is null and (kgs <> 0 or meters <> 0))
  )
);
create index stock_adjustments_lot_idx on public.stock_adjustments (yarn_lot_id) where yarn_lot_id is not null;
create index stock_adjustments_grey_idx on public.stock_adjustments (fabric_quality_id, factory_id) where fabric_quality_id is not null;
comment on table public.stock_adjustments is 'Signed corrections: +kgs adds stock, -kgs removes it. For yarn_lot rows factory_id is copied from the lot.';

-- ---------------------------------------------------------------------------
-- Audit log: every insert/update/delete on business tables
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text not null,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_changed_at_idx on public.audit_log (changed_at desc);

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- skip no-op updates
  if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
    return null;
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name, coalesce(v_new, v_old) ->> coalesce(tg_argv[0], 'id'), tg_op, v_old, v_new, auth.uid());
  return null;
end;
$$;

-- Attach row-meta + audit triggers to every business table.
do $$
declare
  t text;
  pk text;
begin
  foreach t in array array[
    'factories', 'app_users', 'looms', 'yarn_qualities', 'fabric_qualities', 'suppliers',
    'app_settings', 'yarn_lots', 'beams', 'yarn_consumption', 'grey_fabric_production',
    'grey_fabric_dispatch', 'stock_adjustments'
  ] loop
    pk := case when t = 'app_settings' then 'key' else 'id' end;
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.set_row_meta()', t || '_row_meta', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_log(%L)', t || '_audit', t, pk);
  end loop;
end;
$$;

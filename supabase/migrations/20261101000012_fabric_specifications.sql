-- =============================================================================
-- 0012 · Parent fabric qualities with multiple specifications
--
--   fabric_qualities      parent quality (name, planning parameters) — unchanged
--   fabric_specifications many per parent: Reed, Total Ends per Inch, warp yarn,
--                         weft yarn (independent fields, nothing derived), a
--                         system-generated Specification ID, active flag.
--
-- Beams, production entries, dispatches and grey adjustments now carry the exact
-- specification (composite FK guarantees it belongs to the row's parent quality).
-- Rolls and yarn consumption reach their specification through the production
-- entry / beam they belong to. Grey stock is held per specification per factory;
-- parent reports add the specifications up.
--
-- Existing data: every existing quality gets one specification (S1) with its
-- current warp/weft yarns; Reed and Ends per Inch start blank (never recorded
-- before). All existing beams, production and stock move to that S1 unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Specifications
-- ---------------------------------------------------------------------------
create table public.fabric_specifications (
  id                    uuid primary key default gen_random_uuid(),
  fabric_quality_id     uuid not null references public.fabric_qualities (id),
  seq                   integer not null,
  spec_code             text not null,
  reed                  numeric(8,2) check (reed is null or reed > 0),
  ends_per_inch         numeric(8,2) check (ends_per_inch is null or ends_per_inch > 0),
  warp_yarn_quality_id  uuid references public.yarn_qualities (id),
  weft_yarn_quality_id  uuid references public.yarn_qualities (id),
  active                boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  constraint fabric_specifications_seq_key unique (fabric_quality_id, seq),
  -- target for composite foreign keys (spec must belong to the row's parent quality)
  constraint fabric_specifications_id_quality_key unique (id, fabric_quality_id)
);
comment on table public.fabric_specifications is 'Specifications of a parent fabric quality: reed, ends per inch, warp and weft yarn';
comment on column public.fabric_specifications.spec_code is 'System-generated Specification ID, e.g. QUALITY101-S2';
comment on column public.fabric_specifications.reed is 'Reed (independent of ends per inch; never derived)';
comment on column public.fabric_specifications.ends_per_inch is 'Total ends per inch (independent of reed; never derived)';

create unique index fabric_specifications_code_key on public.fabric_specifications (lower(spec_code));
-- The same combination cannot be entered twice under one parent (blank = blank).
create unique index fabric_specifications_combo_key
  on public.fabric_specifications (fabric_quality_id, reed, ends_per_inch, warp_yarn_quality_id, weft_yarn_quality_id)
  nulls not distinct;
create index fabric_specifications_quality_idx on public.fabric_specifications (fabric_quality_id, seq);

-- Specification ID: <PARENT NAME, letters/digits only>-S<n>, n per parent.
create or replace function public.trg_fabric_spec_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_prefix text;
  v_code text;
  v_try int := 1;
begin
  if tg_op = 'INSERT' then
    select name into v_name from public.fabric_qualities where id = new.fabric_quality_id for update;
    select coalesce(max(seq), 0) + 1 into new.seq from public.fabric_specifications where fabric_quality_id = new.fabric_quality_id;
    -- Reuse the prefix already used by this parent's specs, so codes stay together.
    select regexp_replace(spec_code, '-S\d+$', '') into v_prefix
    from public.fabric_specifications where fabric_quality_id = new.fabric_quality_id order by seq limit 1;
    if v_prefix is null then
      v_prefix := left(upper(regexp_replace(coalesce(v_name, ''), '[^A-Za-z0-9]+', '', 'g')), 16);
      if v_prefix = '' then v_prefix := 'Q'; end if;
      -- Two parents can reduce to the same letters (e.g. "S-813A A/S" and "s-813a/as"): add a number.
      while exists (select 1 from public.fabric_specifications s
                    where regexp_replace(s.spec_code, '-S\d+$', '') = case when v_try = 1 then v_prefix else v_prefix || v_try end) loop
        v_try := v_try + 1;
      end loop;
      if v_try > 1 then v_prefix := v_prefix || v_try; end if;
    end if;
    v_code := v_prefix || '-S' || new.seq;
    new.spec_code := v_code;
  else
    new.seq := old.seq;
    new.spec_code := old.spec_code;
    new.fabric_quality_id := old.fabric_quality_id;
    -- Specs with beams are history: their defining fields are locked (make a new spec instead).
    if (new.reed, new.ends_per_inch, new.warp_yarn_quality_id, new.weft_yarn_quality_id)
       is distinct from (old.reed, old.ends_per_inch, old.warp_yarn_quality_id, old.weft_yarn_quality_id)
       and exists (select 1 from public.beams b where b.fabric_specification_id = old.id)
       -- blank values may still be filled in once (e.g. reed / ends per inch of migrated specs)
       and not (
         (old.reed is null or new.reed is not distinct from old.reed)
         and (old.ends_per_inch is null or new.ends_per_inch is not distinct from old.ends_per_inch)
         and (old.warp_yarn_quality_id is null or new.warp_yarn_quality_id is not distinct from old.warp_yarn_quality_id)
         and (old.weft_yarn_quality_id is null or new.weft_yarn_quality_id is not distinct from old.weft_yarn_quality_id)
       ) then
      raise exception 'Specification % already has production history; its reed, ends per inch and yarns cannot change. Add a new specification instead.', old.spec_code
        using errcode = 'WV004';
    end if;
  end if;
  return new;
end;
$$;

-- Note: spec_code / seq are set by this trigger; the NOT NULLs are checked after it.
create trigger fabric_specifications_before before insert or update on public.fabric_specifications
  for each row execute function public.trg_fabric_spec_before();
create trigger fabric_specifications_row_meta before insert or update on public.fabric_specifications
  for each row execute function public.set_row_meta();
create trigger fabric_specifications_audit after insert or update or delete on public.fabric_specifications
  for each row execute function public.write_audit_log('id');

alter table public.fabric_specifications enable row level security;
grant select, insert, update, delete on public.fabric_specifications to authenticated;
create policy fabric_specifications_select on public.fabric_specifications for select to authenticated using (public.app_role() is not null);
create policy fabric_specifications_insert on public.fabric_specifications for insert to authenticated with check (public.app_role() in ('owner', 'supervisor'));
create policy fabric_specifications_update on public.fabric_specifications for update to authenticated
  using (public.app_role() in ('owner', 'supervisor')) with check (public.app_role() in ('owner', 'supervisor'));
create policy fabric_specifications_delete on public.fabric_specifications for delete to authenticated using (public.app_role() = 'owner');

-- One S1 per existing quality, with its current yarns (reed / ends per inch to be filled in).
insert into public.fabric_specifications (fabric_quality_id, seq, spec_code, warp_yarn_quality_id, weft_yarn_quality_id, notes)
select fq.id, 0, '', fq.warp_yarn_quality_id, fq.weft_yarn_quality_id,
       'Created from the existing quality when specifications were introduced. Fill in reed and ends per inch.'
from public.fabric_qualities fq
order by fq.created_at, fq.name;

-- Used when an older code path or import gives only the parent quality.
create or replace function public.only_spec_of(p_fabric_quality_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(id))[1] end
  from public.fabric_specifications
  where fabric_quality_id = p_fabric_quality_id and active
$$;

-- Fill / check the (quality, specification) pair on a row: spec wins; a parent
-- with exactly one active spec may be given alone.
create or replace function public.resolve_spec(p_fabric_quality_id uuid, p_spec_id uuid, p_what text,
                                               out fabric_quality_id uuid, out spec_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_spec_id is not null then
    select s.fabric_quality_id into fabric_quality_id from public.fabric_specifications s where s.id = p_spec_id;
    if not found then
      raise exception 'Specification not found' using errcode = 'WV004';
    end if;
    -- Never move a row to another parent quality silently.
    if p_fabric_quality_id is not null and p_fabric_quality_id <> fabric_quality_id then
      raise exception 'Specification % does not belong to %',
          (select spec_code from public.fabric_specifications where id = p_spec_id),
          (select name from public.fabric_qualities where id = p_fabric_quality_id)
        using errcode = 'WV004';
    end if;
    spec_id := p_spec_id;
    return;
  end if;
  spec_id := public.only_spec_of(p_fabric_quality_id);
  fabric_quality_id := p_fabric_quality_id;
  if spec_id is null then
    select name into v_name from public.fabric_qualities where id = p_fabric_quality_id;
    raise exception 'Choose the specification of % for this %', coalesce(v_name, 'the fabric quality'), p_what
      using errcode = 'WV004';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Beams
-- ---------------------------------------------------------------------------
alter table public.beams add column fabric_specification_id uuid;
update public.beams b set fabric_specification_id = s.id
  from public.fabric_specifications s where s.fabric_quality_id = b.fabric_quality_id and s.seq = 1;
alter table public.beams alter column fabric_specification_id set not null;
alter table public.beams add constraint beams_specification_fkey
  foreign key (fabric_specification_id, fabric_quality_id) references public.fabric_specifications (id, fabric_quality_id);
create index beams_specification_idx on public.beams (fabric_specification_id);

create or replace function public.trg_beam_spec()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_active boolean;
begin
  if tg_op = 'UPDATE' and new.fabric_specification_id is not distinct from old.fabric_specification_id
     and new.fabric_quality_id is not distinct from old.fabric_quality_id then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.fabric_specification_id is distinct from old.fabric_specification_id
     and exists (select 1 from public.grey_fabric_production p where p.beam_id = old.id) then
    raise exception 'Beam % already has production; its specification cannot change', old.beam_no using errcode = 'WV004';
  end if;
  select * into r from public.resolve_spec(new.fabric_quality_id, new.fabric_specification_id, 'beam');
  new.fabric_quality_id := r.fabric_quality_id;
  new.fabric_specification_id := r.spec_id;
  select active into v_active from public.fabric_specifications where id = new.fabric_specification_id;
  if tg_op = 'INSERT' and not v_active then
    raise exception 'That specification is deactivated' using errcode = 'WV004';
  end if;
  return new;
end;
$$;
-- Runs before trg_beam_before (alphabetical: beams_a… < beams_before…).
create trigger beams_a_spec before insert or update on public.beams
  for each row execute function public.trg_beam_spec();

-- ---------------------------------------------------------------------------
-- Looms: optional assigned specification (the reed fitted on the loom)
-- ---------------------------------------------------------------------------
alter table public.looms add column fabric_specification_id uuid references public.fabric_specifications (id);
comment on column public.looms.fabric_specification_id is 'Specification this loom is set up for; when set, only beams of that specification can be loaded';

create or replace function public.trg_beam_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loom   public.looms;
  v_other  text;
  v_assigned text;
  v_beam_spec text;
begin
  if new.status = 'on_loom' and (tg_op = 'INSERT' or old.status <> 'on_loom' or old.loom_id is distinct from new.loom_id) then
    if new.loom_id is null then
      raise exception 'Pick a loom to load beam % on', new.beam_no using errcode = 'WV004';
    end if;
    select * into v_loom from public.looms where id = new.loom_id for update;
    if not found then
      raise exception 'Loom not found' using errcode = 'WV002';
    end if;
    if not v_loom.active then
      raise exception 'Loom % is deactivated', v_loom.machine_no using errcode = 'WV002';
    end if;
    if v_loom.status = 'maintenance' then
      raise exception 'Loom % is under maintenance', v_loom.machine_no using errcode = 'WV002';
    end if;
    if v_loom.fabric_specification_id is not null and v_loom.fabric_specification_id <> new.fabric_specification_id then
      select spec_code into v_assigned from public.fabric_specifications where id = v_loom.fabric_specification_id;
      select spec_code into v_beam_spec from public.fabric_specifications where id = new.fabric_specification_id;
      raise exception 'Loom % is set up for %; beam % is %. Change the loom''s specification in Settings first.',
          v_loom.machine_no, v_assigned, new.beam_no, v_beam_spec
        using errcode = 'WV002';
    end if;
    select b.beam_no into v_other
    from public.beams b
    where b.loom_id = new.loom_id and b.status = 'on_loom' and b.id <> new.id;
    if found then
      raise exception 'Loom % already has beam % running. Finish or unload it first.', v_loom.machine_no, v_other
        using errcode = 'WV002',
              detail = json_build_object('machine_no', v_loom.machine_no, 'running_beam_no', v_other)::text;
    end if;
    new.loaded_at   := coalesce(new.loaded_at, now());
    new.finished_at := null;
    new.factory_id  := v_loom.factory_id;   -- the beam is now physically at this factory
  end if;

  if new.status = 'finished' and (tg_op = 'INSERT' or old.status <> 'finished') then
    new.finished_at := coalesce(new.finished_at, now());
  end if;

  if new.status = 'prepared' and tg_op = 'UPDATE' and old.status <> 'prepared' then
    if exists (select 1 from public.grey_fabric_production p where p.beam_id = new.id) then
      raise exception 'Beam % already has fabric take-offs; it cannot go back to prepared', new.beam_no
        using errcode = 'WV004';
    end if;
    new.loom_id := null;
    new.loaded_at := null;
    new.finished_at := null;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Production entries (rolls reach their specification through the entry)
-- ---------------------------------------------------------------------------
alter table public.grey_fabric_production add column fabric_specification_id uuid;
update public.grey_fabric_production p set fabric_specification_id = b.fabric_specification_id
  from public.beams b where b.id = p.beam_id;
alter table public.grey_fabric_production alter column fabric_specification_id set not null;
alter table public.grey_fabric_production add constraint grey_production_specification_fkey
  foreign key (fabric_specification_id, fabric_quality_id) references public.fabric_specifications (id, fabric_quality_id);
create index grey_production_specification_idx on public.grey_fabric_production (fabric_specification_id);

create or replace function public.trg_grey_production_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_beam public.beams;
  v_quality text;
  v_spec text;
begin
  select * into v_beam from public.beams where id = new.beam_id;

  if new.fabric_quality_id is null then
    new.fabric_quality_id := v_beam.fabric_quality_id;
  elsif new.fabric_quality_id <> v_beam.fabric_quality_id then
    select name into v_quality from public.fabric_qualities where id = v_beam.fabric_quality_id;
    raise exception 'Beam % is weaving %, not the fabric quality selected', v_beam.beam_no, v_quality
      using errcode = 'WV004';
  end if;
  if new.fabric_specification_id is null then
    new.fabric_specification_id := v_beam.fabric_specification_id;
  elsif new.fabric_specification_id <> v_beam.fabric_specification_id then
    select spec_code into v_spec from public.fabric_specifications where id = v_beam.fabric_specification_id;
    raise exception 'Beam % is weaving specification %, not the specification selected', v_beam.beam_no, v_spec
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
-- Dispatch and grey adjustments carry the specification
-- ---------------------------------------------------------------------------
alter table public.grey_fabric_dispatch add column fabric_specification_id uuid;
update public.grey_fabric_dispatch d set fabric_specification_id = s.id
  from public.fabric_specifications s where s.fabric_quality_id = d.fabric_quality_id and s.seq = 1;
alter table public.grey_fabric_dispatch alter column fabric_specification_id set not null;
alter table public.grey_fabric_dispatch add constraint grey_dispatch_specification_fkey
  foreign key (fabric_specification_id, fabric_quality_id) references public.fabric_specifications (id, fabric_quality_id);
create index grey_dispatch_specification_idx on public.grey_fabric_dispatch (fabric_specification_id, factory_id);

alter table public.stock_adjustments add column fabric_specification_id uuid;
update public.stock_adjustments a set fabric_specification_id = s.id
  from public.fabric_specifications s
 where a.item_type = 'grey_fabric' and s.fabric_quality_id = a.fabric_quality_id and s.seq = 1;
alter table public.stock_adjustments
  add constraint stock_adjustments_specification_fkey
    foreign key (fabric_specification_id, fabric_quality_id) references public.fabric_specifications (id, fabric_quality_id),
  add constraint stock_adjustments_grey_has_spec check (item_type = 'yarn_lot' or fabric_specification_id is not null);

create or replace function public.trg_fill_spec()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- (nested: NEW of grey_fabric_dispatch has no item_type, and plpgsql does not short-circuit AND)
  if tg_table_name = 'stock_adjustments' then
    if (to_jsonb(new) ->> 'item_type') <> 'grey_fabric' then
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.fabric_specification_id is not distinct from old.fabric_specification_id
     and new.fabric_quality_id is not distinct from old.fabric_quality_id then
    return new;
  end if;
  select * into r from public.resolve_spec(new.fabric_quality_id, new.fabric_specification_id,
                                           case tg_table_name when 'grey_fabric_dispatch' then 'dispatch' else 'adjustment' end);
  new.fabric_quality_id := r.fabric_quality_id;
  new.fabric_specification_id := r.spec_id;
  return new;
end;
$$;
create trigger grey_dispatch_a_spec before insert or update on public.grey_fabric_dispatch
  for each row execute function public.trg_fill_spec();
create trigger stock_adjustments_a_spec before insert or update on public.stock_adjustments
  for each row execute function public.trg_fill_spec();

-- ---------------------------------------------------------------------------
-- Grey stock per specification per factory
-- ---------------------------------------------------------------------------
create or replace function public.grey_spec_balance(p_spec_id uuid, p_factory_id uuid, out meters numeric, out kgs numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.meters), 0), coalesce(sum(m.kgs), 0)
  from (
    select p.net_meters as meters, p.kgs
    from public.grey_fabric_production p join public.looms l on l.id = p.loom_id
    where p.fabric_specification_id = p_spec_id and l.factory_id = p_factory_id
    union all
    select -d.meters, -d.kgs from public.grey_fabric_dispatch d
    where d.fabric_specification_id = p_spec_id and d.factory_id = p_factory_id
    union all
    select a.meters, a.kgs from public.stock_adjustments a
    where a.item_type = 'grey_fabric' and a.fabric_specification_id = p_spec_id and a.factory_id = p_factory_id
  ) m
$$;

create or replace function public.grey_spec_unweighed_count(p_spec_id uuid, p_factory_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.grey_fabric_production p join public.looms l on l.id = p.loom_id
  where p.fabric_specification_id = p_spec_id and l.factory_id = p_factory_id and p.kgs is null
$$;

create or replace function public.assert_grey_spec_not_negative(p_spec_id uuid, p_factory_id uuid,
                                                                p_requested_m numeric, p_requested_kg numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bal record;
  v_label text;
  v_factory text;
  v_kg_known boolean;
  v_avail text;
begin
  if p_spec_id is null or p_factory_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grey:' || p_spec_id::text || ':' || p_factory_id::text, 0));
  select * into v_bal from public.grey_spec_balance(p_spec_id, p_factory_id);
  v_kg_known := public.grey_spec_unweighed_count(p_spec_id, p_factory_id) = 0;
  if v_bal.meters < 0 or (v_kg_known and v_bal.kgs < 0) then
    select fq.name || ' · ' || s.spec_code into v_label
    from public.fabric_specifications s join public.fabric_qualities fq on fq.id = s.fabric_quality_id where s.id = p_spec_id;
    select code into v_factory from public.factories where id = p_factory_id;
    v_avail := to_char(v_bal.meters + coalesce(p_requested_m, 0), 'FM999999990.00') || ' m'
            || case when v_kg_known then ' / ' || to_char(v_bal.kgs + coalesce(p_requested_kg, 0), 'FM999999990.000') || ' kg' else '' end;
    raise exception 'Not enough grey stock of % at %: % available', v_label, v_factory, v_avail
      using errcode = 'WV003',
            detail = json_build_object(
              'fabric_quality', v_label, 'factory', v_factory,
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
    perform public.assert_grey_spec_not_negative(new.fabric_specification_id, new.factory_id, new.meters, coalesce(new.kgs, 0));
  elsif tg_op = 'UPDATE' then
    if (new.fabric_specification_id, new.factory_id) = (old.fabric_specification_id, old.factory_id) then
      perform public.assert_grey_spec_not_negative(new.fabric_specification_id, new.factory_id,
                                                   greatest(new.meters - old.meters, 0), greatest(coalesce(new.kgs, 0) - coalesce(old.kgs, 0), 0));
    else
      perform public.assert_grey_spec_not_negative(new.fabric_specification_id, new.factory_id, new.meters, coalesce(new.kgs, 0));
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
  perform public.assert_grey_spec_not_negative(old.fabric_specification_id, v_factory, 0, 0);
  return null;
end;
$$;

create or replace function public.trg_stock_adjustment_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    if new.item_type = 'yarn_lot' then
      perform public.assert_yarn_lot_not_negative(new.yarn_lot_id, greatest(-new.kgs, 0));
    else
      perform public.assert_grey_spec_not_negative(new.fabric_specification_id, new.factory_id,
                                                   greatest(-new.meters, 0), greatest(-new.kgs, 0));
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    if old.item_type = 'yarn_lot' then
      perform public.assert_yarn_lot_not_negative(old.yarn_lot_id, greatest(old.kgs, 0));
    else
      perform public.assert_grey_spec_not_negative(old.fabric_specification_id, old.factory_id,
                                                   greatest(old.meters, 0), greatest(old.kgs, 0));
    end if;
  end if;
  return null;
end;
$$;

-- The quality-level checks are replaced by the specification-level ones above.
drop function public.assert_grey_stock_not_negative(uuid, uuid, numeric, numeric);
drop function public.grey_unweighed_count(uuid, uuid);
drop function public.grey_stock_balance(uuid, uuid);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Specifications with names, deniers and whether they have history.
create view public.v_fabric_specifications with (security_invoker = true) as
  select s.id, s.fabric_quality_id, fq.name as fabric_quality_name, s.seq, s.spec_code,
         s.reed, s.ends_per_inch,
         s.warp_yarn_quality_id, w.name as warp_yarn_quality_name, w.denier as warp_denier,
         s.weft_yarn_quality_id, f.name as weft_yarn_quality_name, f.denier as weft_denier,
         s.active, s.notes, fq.active as quality_active,
         (select count(*) from public.beams b where b.fabric_specification_id = s.id) as beam_count,
         exists (select 1 from public.beams b where b.fabric_specification_id = s.id) as has_history,
         s.created_at
  from public.fabric_specifications s
  join public.fabric_qualities fq on fq.id = s.fabric_quality_id
  left join public.yarn_qualities w on w.id = s.warp_yarn_quality_id
  left join public.yarn_qualities f on f.id = s.weft_yarn_quality_id;

create or replace view public.v_fabric_qualities with (security_invoker = true) as
  select fq.*, w.name as warp_yarn_quality_name, f.name as weft_yarn_quality_name,
         w.denier as warp_denier, f.denier as weft_denier,
         (select count(*) from public.fabric_specifications s where s.fabric_quality_id = fq.id) as spec_count,
         (select count(*) from public.fabric_specifications s where s.fabric_quality_id = fq.id and s.active) as active_spec_count
  from public.fabric_qualities fq
  left join public.yarn_qualities w on w.id = fq.warp_yarn_quality_id
  left join public.yarn_qualities f on f.id = fq.weft_yarn_quality_id;

create or replace view public.v_grey_ledger with (security_invoker = true) as
  select p.fabric_quality_id, lm.factory_id, p.entry_date, 'production' as movement_type,
         p.id as ref_id, p.beam_id, p.loom_id, p.roll_no as reference,
         p.net_meters as meters, p.kgs, p.created_at, p.fabric_specification_id
  from public.grey_fabric_production p
  join public.looms lm on lm.id = p.loom_id
  union all
  select d.fabric_quality_id, d.factory_id, d.entry_date, 'dispatch',
         d.id, null, null, coalesce(d.challan_no, d.party),
         -d.meters, -d.kgs, d.created_at, d.fabric_specification_id
  from public.grey_fabric_dispatch d
  union all
  select a.fabric_quality_id, a.factory_id, a.entry_date,
         case when a.is_opening then 'opening' else 'adjustment' end,
         a.id, null, null, a.reason,
         a.meters, a.kgs, a.created_at, a.fabric_specification_id
  from public.stock_adjustments a
  where a.item_type = 'grey_fabric';

-- Grey stock: one row per specification per factory (never merged across specs).
drop view public.v_grey_stock_by_quality;
drop view public.v_grey_stock;
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
         coalesce(sum(g.kgs), 0) as stock_kg,
         count(*) filter (where g.movement_type = 'production' and g.kgs is null) as unweighed_count,
         g.fabric_specification_id, s.spec_code, s.reed, s.ends_per_inch,
         w.name as warp_yarn_quality_name, wf.name as weft_yarn_quality_name
  from public.v_grey_ledger g
  join public.fabric_qualities fq on fq.id = g.fabric_quality_id
  join public.factories f on f.id = g.factory_id
  join public.fabric_specifications s on s.id = g.fabric_specification_id
  left join public.yarn_qualities w on w.id = s.warp_yarn_quality_id
  left join public.yarn_qualities wf on wf.id = s.weft_yarn_quality_id
  group by g.fabric_quality_id, fq.name, g.factory_id, f.code, g.fabric_specification_id, s.spec_code, s.reed, s.ends_per_inch, w.name, wf.name;

-- Parent quality consolidated (all specifications, all factories).
create view public.v_grey_stock_by_quality with (security_invoker = true) as
  select fabric_quality_id, fabric_quality_name,
         sum(produced_m) as produced_m, sum(produced_kg) as produced_kg,
         sum(dispatched_m) as dispatched_m, sum(dispatched_kg) as dispatched_kg,
         sum(adjusted_m) as adjusted_m, sum(adjusted_kg) as adjusted_kg,
         sum(stock_m) as stock_m, sum(stock_kg) as stock_kg,
         sum(unweighed_count) as unweighed_count,
         count(distinct fabric_specification_id) as spec_count
  from public.v_grey_stock
  group by fabric_quality_id, fabric_quality_name;

-- Beam summary + loom status gain the specification (appended columns).
drop view public.v_loom_status;
drop view public.v_beam_summary;

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
         coalesce(g.wasted, 0) as wasted_meters,
         coalesce(g.net, 0) as net_meters,
         case when coalesce(g.meters, 0) > 0 then round(g.wasted / g.meters * 100, 2) end as wastage_pct,
         coalesce(g.takeoffs, 0) as takeoff_count,
         coalesce(g.rolls, 0) as roll_count,
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
         case when g.weighed_kg > 0 then round(g.weighed_meters / g.weighed_kg, 3) end as meters_per_kg,
         -- specification
         b.fabric_specification_id, s.spec_code, s.reed, s.ends_per_inch,
         s.warp_yarn_quality_id as spec_warp_yarn_quality_id, coalesce(sw.name, wq.name) as warp_yarn_quality_name,
         s.weft_yarn_quality_id as spec_weft_yarn_quality_id, coalesce(sf.name, fy.name) as weft_yarn_quality_name
  from public.beams b
  join public.factories f on f.id = b.factory_id
  join public.fabric_qualities fq on fq.id = b.fabric_quality_id
  join public.fabric_specifications s on s.id = b.fabric_specification_id
  left join public.yarn_qualities sw on sw.id = s.warp_yarn_quality_id
  left join public.yarn_qualities sf on sf.id = s.weft_yarn_quality_id
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
  -- Planning uses the specification's yarn deniers (falling back to the parent's yarns).
  cross join lateral (
    select public.planned_warp_kg(fq.total_ends, b.warp_length_m, coalesce(sw.denier, wq.denier), fq.warp_crimp_pct) as planned_warp_kg,
           public.planned_weft_kg(fq.picks_per_inch, fq.reed_width_m,
                                  public.expected_fabric_length_m(b.warp_length_m, fq.warp_crimp_pct),
                                  coalesce(sf.denier, fy.denier), fq.weft_wastage_pct) as planned_weft_kg
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
         bs.net_meters as net_on_beam,
         -- specification running now (from the beam) and the one the loom is set up for
         bs.fabric_specification_id, bs.spec_code, bs.reed, bs.ends_per_inch,
         bs.warp_yarn_quality_name, bs.weft_yarn_quality_name,
         lm.fabric_specification_id as assigned_specification_id, asg.spec_code as assigned_spec_code
  from public.looms lm
  join public.factories f on f.id = lm.factory_id
  left join public.beams b on b.loom_id = lm.id and b.status = 'on_loom'
  left join public.v_beam_summary bs on bs.beam_id = b.id
  left join public.fabric_specifications asg on asg.id = lm.fabric_specification_id;

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
         (select count(*) from public.fabric_rolls r where r.production_id = p.id) as roll_count,
         p.fabric_specification_id, s.spec_code, s.reed, s.ends_per_inch,
         sw.name as warp_yarn_quality_name, sf.name as weft_yarn_quality_name
  from public.grey_fabric_production p
  join public.beams b on b.id = p.beam_id
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  join public.fabric_qualities fq on fq.id = p.fabric_quality_id
  join public.fabric_specifications s on s.id = p.fabric_specification_id
  left join public.yarn_qualities sw on sw.id = s.warp_yarn_quality_id
  left join public.yarn_qualities sf on sf.id = s.weft_yarn_quality_id
  left join public.app_users u on u.id = p.created_by;

-- Daily production per loom and specification.
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
         sum(p.waste_kg_estimated) as waste_kg_estimated,
         p.fabric_specification_id, s.spec_code
  from public.grey_fabric_production p
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  join public.fabric_qualities fq on fq.id = p.fabric_quality_id
  join public.fabric_specifications s on s.id = p.fabric_specification_id
  group by p.entry_date, lm.factory_id, f.code, p.loom_id, lm.machine_no, p.fabric_quality_id, fq.name, p.fabric_specification_id, s.spec_code;

create or replace view public.v_fabric_rolls with (security_invoker = true) as
  select r.id, r.roll_no, r.seq, r.meters, r.created_at,
         p.id as production_id, p.entry_date, p.shift,
         p.beam_id, b.beam_no, p.loom_id, lm.machine_no, lm.factory_id, f.code as factory_code,
         p.fabric_quality_id, fq.name as fabric_quality_name,
         p.fabric_specification_id, s.spec_code, s.reed, s.ends_per_inch
  from public.fabric_rolls r
  join public.grey_fabric_production p on p.id = r.production_id
  join public.beams b on b.id = p.beam_id
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  join public.fabric_qualities fq on fq.id = p.fabric_quality_id
  join public.fabric_specifications s on s.id = p.fabric_specification_id;

create or replace view public.v_dispatches with (security_invoker = true) as
  select d.id, d.entry_date, d.meters, d.kgs, d.roll_refs, d.party, d.challan_no, d.notes, d.created_at,
         d.fabric_quality_id, fq.name as fabric_quality_name,
         d.factory_id, f.code as factory_code,
         d.created_by, u.name as created_by_name,
         d.fabric_specification_id, s.spec_code
  from public.grey_fabric_dispatch d
  join public.fabric_qualities fq on fq.id = d.fabric_quality_id
  join public.factories f on f.id = d.factory_id
  join public.fabric_specifications s on s.id = d.fabric_specification_id
  left join public.app_users u on u.id = d.created_by;

-- Yarn consumption with the specification it was issued for (through the beam).
create or replace view public.v_consumption_lines with (security_invoker = true) as
  select c.id, c.beam_id, b.beam_no, c.yarn_lot_id, l.lot_no,
         l.yarn_quality_id, q.name as yarn_quality_name,
         c.usage_type, c.kgs, c.entry_date, c.created_at,
         c.created_by, u.name as created_by_name,
         b.fabric_quality_id, b.fabric_specification_id, s.spec_code
  from public.yarn_consumption c
  join public.beams b on b.id = c.beam_id
  join public.yarn_lots l on l.id = c.yarn_lot_id
  join public.yarn_qualities q on q.id = l.yarn_quality_id
  join public.fabric_specifications s on s.id = b.fabric_specification_id
  left join public.app_users u on u.id = c.created_by;

grant select on public.v_fabric_specifications, public.v_grey_stock, public.v_grey_stock_by_quality,
                public.v_beam_summary, public.v_loom_status to authenticated;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
drop function public.report_grey_summary(date, date, uuid);
create function public.report_grey_summary(p_from date, p_to date, p_factory_id uuid default null)
returns table (
  fabric_quality_id uuid, fabric_quality_name text, factory_id uuid, factory_code text,
  opening_m numeric, opening_kg numeric, produced_m numeric, produced_kg numeric,
  dispatched_m numeric, dispatched_kg numeric, adjusted_m numeric, adjusted_kg numeric,
  closing_m numeric, closing_kg numeric,
  fabric_specification_id uuid, spec_code text
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
         coalesce(sum(g.kgs)    filter (where g.entry_date <= p_to), 0),
         g.fabric_specification_id, s.spec_code
  from public.v_grey_ledger g
  join public.fabric_qualities fq on fq.id = g.fabric_quality_id
  join public.factories f on f.id = g.factory_id
  join public.fabric_specifications s on s.id = g.fabric_specification_id
  where p_factory_id is null or g.factory_id = p_factory_id
  group by g.fabric_quality_id, fq.name, g.factory_id, f.code, g.fabric_specification_id, s.spec_code, s.seq
  having bool_or(g.entry_date <= p_to)
  order by fq.name, s.seq, f.code desc
$$;

drop function public.report_loom_production(date, date, uuid, text, uuid, uuid, text);
create function public.report_loom_production(
  p_from date, p_to date, p_factory_id uuid default null, p_period text default 'day',
  p_loom_id uuid default null, p_fabric_quality_id uuid default null, p_beam_no text default null,
  p_fabric_specification_id uuid default null)
returns table (
  period date, factory_code text, machine_no text, fabric_quality_name text,
  takeoff_count bigint, meters numeric, wasted_meters numeric, net_meters numeric, wastage_pct numeric,
  estimated_kg numeric, kgs numeric, warp_kg numeric, weft_kg numeric, total_yarn_kg numeric,
  waste_kg numeric, waste_kg_estimated numeric, spec_code text
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
         sum(t.waste_kg), sum(t.waste_kg_estimated), t.spec_code
  from public.v_takeoffs t
  where t.entry_date between p_from and p_to
    and (p_factory_id is null or t.factory_id = p_factory_id)
    and (p_loom_id is null or t.loom_id = p_loom_id)
    and (p_fabric_quality_id is null or t.fabric_quality_id = p_fabric_quality_id)
    and (p_fabric_specification_id is null or t.fabric_specification_id = p_fabric_specification_id)
    and (p_beam_no is null or lower(t.beam_no) = lower(p_beam_no))
  group by 1, t.factory_code, t.machine_no, t.fabric_quality_name, t.spec_code
  order by 1, t.factory_code desc, t.machine_no, t.fabric_quality_name, t.spec_code
$$;

-- Specification-wise summary for a period; the app adds parent-quality totals.
create function public.report_specification_summary(
  p_from date, p_to date, p_factory_id uuid default null,
  p_fabric_quality_id uuid default null, p_fabric_specification_id uuid default null)
returns table (
  fabric_quality_id uuid, fabric_quality_name text, fabric_specification_id uuid, spec_code text, seq integer,
  reed numeric, ends_per_inch numeric, warp_yarn_quality_name text, weft_yarn_quality_name text, active boolean,
  takeoff_count bigint, meters numeric, wasted_meters numeric, net_meters numeric, roll_count bigint,
  estimated_kg numeric, kgs numeric, prod_warp_kg numeric, prod_weft_kg numeric, waste_kg numeric, waste_kg_estimated numeric,
  warp_issued_kg numeric, weft_issued_kg numeric,
  stock_m numeric, stock_kg numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.fabric_quality_id, s.fabric_quality_name, s.id, s.spec_code, s.seq,
         s.reed, s.ends_per_inch, s.warp_yarn_quality_name, s.weft_yarn_quality_name, s.active,
         coalesce(pr.n, 0), pr.meters, pr.wasted, pr.net, coalesce(pr.rolls, 0),
         pr.est, pr.kgs, pr.warp, pr.weft, pr.waste, pr.waste_est,
         yc.warp, yc.weft,
         st.m, st.kg
  from public.v_fabric_specifications s
  left join lateral (
    select count(*) as n, sum(t.meters) as meters, sum(t.wasted_meters) as wasted, sum(t.net_meters) as net,
           sum(t.roll_count) as rolls, sum(t.estimated_kg) as est, sum(t.kgs) as kgs,
           sum(t.warp_kg) as warp, sum(t.weft_kg) as weft, sum(t.waste_kg) as waste, sum(t.waste_kg_estimated) as waste_est
    from public.v_takeoffs t
    where t.fabric_specification_id = s.id and t.entry_date between p_from and p_to
      and (p_factory_id is null or t.factory_id = p_factory_id)
  ) pr on true
  left join lateral (
    select sum(c.kgs) filter (where c.usage_type = 'warp') as warp, sum(c.kgs) filter (where c.usage_type = 'weft') as weft
    from public.v_consumption_lines c
    join public.beams b on b.id = c.beam_id
    where c.fabric_specification_id = s.id and c.entry_date between p_from and p_to
      and (p_factory_id is null or b.factory_id = p_factory_id)
  ) yc on true
  left join lateral (
    select sum(g.meters) as m, sum(g.kgs) as kg
    from public.v_grey_ledger g
    where g.fabric_specification_id = s.id and g.entry_date <= p_to
      and (p_factory_id is null or g.factory_id = p_factory_id)
  ) st on true
  where (p_fabric_quality_id is null or s.fabric_quality_id = p_fabric_quality_id)
    and (p_fabric_specification_id is null or s.id = p_fabric_specification_id)
    and (s.active or pr.n > 0 or st.m is not null or yc.warp is not null or yc.weft is not null)
  order by s.fabric_quality_name, s.seq
$$;

grant execute on function public.report_grey_summary(date, date, uuid),
                          public.report_loom_production(date, date, uuid, text, uuid, uuid, text, uuid),
                          public.report_specification_summary(date, date, uuid, uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- record_production(): + the specification (optional; must match the beam)
-- ---------------------------------------------------------------------------
drop function public.record_production(uuid, uuid, numeric, numeric, numeric, date, text, numeric, numeric,
                                       numeric, numeric, numeric, numeric, numeric, text, boolean, uuid);
create function public.record_production(
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
  p_client_ref        uuid default null,
  p_fabric_specification_id uuid default null
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
  if p_client_ref is not null then
    select * into v_row from public.grey_fabric_production where client_ref = p_client_ref;
    if found then
      return v_row;
    end if;
  end if;

  select * into v_loom from public.looms where id = p_loom_id for update;
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
    beam_id, loom_id, fabric_quality_id, fabric_specification_id, entry_date, shift, meters, wasted_meters, roll_length_m,
    gsm, width_m, kgs, warp_kg, weft_kg, waste_kg, waste_pct_entered, notes, client_ref)
  values (
    v_beam_id, p_loom_id, p_fabric_quality_id, p_fabric_specification_id, v_date, p_shift, p_meters, p_wasted_meters, p_roll_length_m,
    p_gsm, p_width_m, p_weighed_kg, p_warp_kg, p_weft_kg, p_waste_kg, p_waste_pct, p_notes, p_client_ref)
  returning * into v_row;

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
                                                   numeric, numeric, numeric, numeric, numeric, text, boolean, uuid, uuid)
  to authenticated;
grant execute on function public.only_spec_of(uuid), public.resolve_spec(uuid, uuid, text),
                          public.grey_spec_balance(uuid, uuid), public.grey_spec_unweighed_count(uuid, uuid)
  to authenticated;

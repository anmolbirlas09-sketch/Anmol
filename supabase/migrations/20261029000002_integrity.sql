-- =============================================================================
-- 0002 · Business rules enforced in the database
--
--   * Yarn stock can never go negative (per lot).            → WV001
--   * One active beam per loom; loom must be usable.         → WV002
--   * Grey stock can never go negative (per quality+factory).→ WV003
--   * Invalid beam / loom state transitions.                 → WV004
--   * Permission denied inside an RPC.                       → WV005
--
-- Errors use custom SQLSTATEs so the UI can show a friendly message. The
-- DETAIL of WV001/WV003 is JSON with the numbers the UI needs, e.g.
--   {"lot_no":"A-101","available_kg":50.000,"requested_kg":100.000}
--
-- Stock checks run in AFTER ROW triggers: they lock the stock "owner" (the
-- yarn lot row, or an advisory lock for a fabric quality+factory), then re-sum
-- the ledger including the new row. Under READ COMMITTED, concurrent writers
-- serialise on that lock and the second one sees the first one's rows.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Caller identity helpers (also used by RLS in 0004)
-- ---------------------------------------------------------------------------

-- true for trusted server-side contexts: migrations, SQL editor, service_role
-- key, test harness. false for PostgREST requests as anon/authenticated.
create or replace function public.is_service_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is null
     and coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated')
$$;

-- Role of the calling user, or null if not an active app user.
create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_service_context() then 'owner'::public.user_role
    else (select u.role from public.app_users u where u.id = auth.uid() and u.active)
  end
$$;

-- Factory the calling user is restricted to (null = all factories).
create or replace function public.app_factory_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_service_context() then null
    else (select u.factory_id from public.app_users u where u.id = auth.uid() and u.active)
  end
$$;

-- May the caller see / add entries for this factory?
create or replace function public.can_access_factory(p_factory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select r is not null
     and (r = 'owner' or public.app_factory_id() is null or public.app_factory_id() = p_factory_id)
  from (select public.app_role() as r) x
$$;

-- May the caller edit / delete entries for this factory? (owner, supervisor)
create or replace function public.can_edit_factory(p_factory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_role() in ('owner', 'supervisor') and public.can_access_factory(p_factory_id)
$$;

create or replace function public.require_factory_access(p_factory_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_access_factory(p_factory_id) then
    raise exception 'You do not have access to this factory'
      using errcode = 'WV005';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- New Supabase auth user → app_users profile.
-- The very first user becomes an active owner; everyone after that starts as
-- an inactive data_entry user until the owner activates them.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first boolean;
begin
  perform pg_advisory_xact_lock(hashtext('app_users.bootstrap'));
  v_first := not exists (select 1 from public.app_users);
  insert into public.app_users (id, name, email, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1), 'User'),
    new.email,
    case when v_first then 'owner' else 'data_entry' end::public.user_role,
    v_first
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Yarn: balances and the non-negative rule
-- ---------------------------------------------------------------------------
create or replace function public.yarn_lot_balance(p_lot_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select l.kgs_received
       - coalesce((select sum(c.kgs) from public.yarn_consumption c where c.yarn_lot_id = l.id), 0)
       + coalesce((select sum(a.kgs) from public.stock_adjustments a where a.yarn_lot_id = l.id), 0)
  from public.yarn_lots l
  where l.id = p_lot_id
$$;

-- Lock the lot, re-sum, and raise WV001 if the balance went negative.
-- p_requested_kg = how much this change takes out of the lot (for the message).
create or replace function public.assert_yarn_lot_not_negative(p_lot_id uuid, p_requested_kg numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot_no  text;
  v_balance numeric;
  v_available numeric;
begin
  select lot_no into v_lot_no from public.yarn_lots where id = p_lot_id for update;
  if not found then
    return;
  end if;
  v_balance := public.yarn_lot_balance(p_lot_id);
  if v_balance < 0 then
    v_available := round(v_balance + p_requested_kg, 3);
    raise exception 'Not enough yarn in lot %: % kg available, % kg requested',
        v_lot_no, to_char(v_available, 'FM999999990.000'), to_char(p_requested_kg, 'FM999999990.000')
      using errcode = 'WV001',
            detail = json_build_object('lot_no', v_lot_no, 'available_kg', v_available, 'requested_kg', round(p_requested_kg, 3))::text,
            hint = 'Reduce the quantity or pick another lot.';
  end if;
end;
$$;

create or replace function public.trg_yarn_consumption_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_yarn_lot_not_negative(new.yarn_lot_id, new.kgs);
  elsif tg_op = 'UPDATE' then
    if new.yarn_lot_id = old.yarn_lot_id then
      if new.kgs > old.kgs then
        perform public.assert_yarn_lot_not_negative(new.yarn_lot_id, new.kgs - old.kgs);
      end if;
    else
      perform public.assert_yarn_lot_not_negative(new.yarn_lot_id, new.kgs);
    end if;
  end if;
  return null;
end;
$$;

create trigger yarn_consumption_stock_check
  after insert or update of kgs, yarn_lot_id on public.yarn_consumption
  for each row execute function public.trg_yarn_consumption_check();

-- Reducing kgs_received on an inward entry must not make the lot negative.
create or replace function public.trg_yarn_lot_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kgs_received < old.kgs_received then
    perform public.assert_yarn_lot_not_negative(new.id, old.kgs_received - new.kgs_received);
  end if;
  return null;
end;
$$;

create trigger yarn_lots_stock_check
  after update of kgs_received on public.yarn_lots
  for each row execute function public.trg_yarn_lot_check();

-- ---------------------------------------------------------------------------
-- Grey fabric: balances and the non-negative rule
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
    select p.meters, p.kgs
    from public.grey_fabric_production p
    join public.beams b on b.id = p.beam_id
    join public.looms l on l.id = p.loom_id
    where b.fabric_quality_id = p_fabric_quality_id and l.factory_id = p_factory_id
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
begin
  if p_fabric_quality_id is null or p_factory_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grey:' || p_fabric_quality_id::text || ':' || p_factory_id::text, 0));
  select * into v_bal from public.grey_stock_balance(p_fabric_quality_id, p_factory_id);
  if v_bal.meters < 0 or v_bal.kgs < 0 then
    select name into v_quality from public.fabric_qualities where id = p_fabric_quality_id;
    select code into v_factory from public.factories where id = p_factory_id;
    raise exception 'Not enough grey stock of % at %: % m / % kg available',
        v_quality, v_factory,
        to_char(v_bal.meters + p_requested_m, 'FM999999990.00'),
        to_char(v_bal.kgs + p_requested_kg, 'FM999999990.000')
      using errcode = 'WV003',
            detail = json_build_object(
              'fabric_quality', v_quality, 'factory', v_factory,
              'available_m', round(v_bal.meters + p_requested_m, 2), 'available_kg', round(v_bal.kgs + p_requested_kg, 3),
              'requested_m', round(p_requested_m, 2), 'requested_kg', round(p_requested_kg, 3))::text;
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
    perform public.assert_grey_stock_not_negative(new.fabric_quality_id, new.factory_id, new.meters, new.kgs);
  elsif tg_op = 'UPDATE' then
    if (new.fabric_quality_id, new.factory_id) = (old.fabric_quality_id, old.factory_id) then
      perform public.assert_grey_stock_not_negative(new.fabric_quality_id, new.factory_id,
                                                    greatest(new.meters - old.meters, 0), greatest(new.kgs - old.kgs, 0));
    else
      perform public.assert_grey_stock_not_negative(new.fabric_quality_id, new.factory_id, new.meters, new.kgs);
    end if;
  end if;
  return null;
end;
$$;

create trigger grey_dispatch_stock_check
  after insert or update on public.grey_fabric_dispatch
  for each row execute function public.trg_grey_dispatch_check();

-- Editing / deleting a take-off must not leave dispatched fabric unaccounted for.
create or replace function public.trg_grey_production_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fq uuid;
  v_factory uuid;
begin
  select b.fabric_quality_id, l.factory_id into v_fq, v_factory
  from public.beams b, public.looms l
  where b.id = old.beam_id and l.id = old.loom_id;
  perform public.assert_grey_stock_not_negative(v_fq, v_factory, 0, 0);
  return null;
end;
$$;

create trigger grey_production_stock_check
  after update or delete on public.grey_fabric_production
  for each row execute function public.trg_grey_production_check();

-- ---------------------------------------------------------------------------
-- Stock adjustments: copy factory from the lot, then check stock
-- ---------------------------------------------------------------------------
create or replace function public.trg_stock_adjustment_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item_type = 'yarn_lot' then
    select factory_id into new.factory_id from public.yarn_lots where id = new.yarn_lot_id;
  end if;
  if tg_op = 'INSERT' and new.approved_by is null then
    new.approved_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger stock_adjustments_before
  before insert or update on public.stock_adjustments
  for each row execute function public.trg_stock_adjustment_before();

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
      perform public.assert_grey_stock_not_negative(new.fabric_quality_id, new.factory_id,
                                                    greatest(-new.meters, 0), greatest(-new.kgs, 0));
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    if old.item_type = 'yarn_lot' then
      perform public.assert_yarn_lot_not_negative(old.yarn_lot_id, greatest(old.kgs, 0));
    else
      perform public.assert_grey_stock_not_negative(old.fabric_quality_id, old.factory_id,
                                                    greatest(old.meters, 0), greatest(old.kgs, 0));
    end if;
  end if;
  return null;
end;
$$;

create trigger stock_adjustments_stock_check
  after insert or update or delete on public.stock_adjustments
  for each row execute function public.trg_stock_adjustment_check();

-- ---------------------------------------------------------------------------
-- Beams and looms
-- ---------------------------------------------------------------------------

-- Validate a beam's state change; lock the target loom so two people cannot
-- load onto the same loom at once (the partial unique index is the backstop).
create or replace function public.trg_beam_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loom   public.looms;
  v_other  text;
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

create trigger beams_before_state
  before insert or update on public.beams
  for each row execute function public.trg_beam_before();

-- Keep looms.status in step with the beams sitting on them.
create or replace function public.sync_loom_status(p_loom_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_loom_id is null then
    return;
  end if;
  update public.looms l
     set status = case
                    when exists (select 1 from public.beams b where b.loom_id = l.id and b.status = 'on_loom') then 'running'
                    when l.status = 'maintenance' then 'maintenance'
                    else 'idle'
                  end::public.loom_status
   where l.id = p_loom_id;
end;
$$;

create or replace function public.trg_beam_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.sync_loom_status(new.loom_id);
  elsif tg_op = 'UPDATE' then
    perform public.sync_loom_status(new.loom_id);
    if old.loom_id is distinct from new.loom_id then
      perform public.sync_loom_status(old.loom_id);
    end if;
  else
    perform public.sync_loom_status(old.loom_id);
  end if;
  return null;
end;
$$;

create trigger beams_after_state
  after insert or update of status, loom_id or delete on public.beams
  for each row execute function public.trg_beam_after();

-- A loom's status is derived: it is 'running' exactly when a beam is on it.
-- Manual edits may only toggle idle <-> maintenance on an empty loom.
create or replace function public.trg_loom_before()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_busy boolean;
begin
  select exists (select 1 from public.beams b where b.loom_id = new.id and b.status = 'on_loom') into v_busy;
  if v_busy then
    if new.status <> 'running' then
      raise exception 'Loom % has a beam running; finish or unload it first', new.machine_no using errcode = 'WV004';
    end if;
    if not new.active then
      raise exception 'Loom % has a beam running and cannot be deactivated', new.machine_no using errcode = 'WV004';
    end if;
  elsif new.status = 'running' then
    new.status := 'idle';
  end if;
  return new;
end;
$$;

create trigger looms_before_status
  before insert or update on public.looms
  for each row execute function public.trg_loom_before();

-- ---------------------------------------------------------------------------
-- Grey production: must come off the loom the beam is running on
-- ---------------------------------------------------------------------------
create or replace function public.trg_grey_production_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_beam public.beams;
begin
  if tg_op = 'UPDATE' and new.beam_id = old.beam_id and new.loom_id = old.loom_id then
    return new;   -- quantity / date corrections on an existing take-off
  end if;
  select * into v_beam from public.beams where id = new.beam_id;
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

create trigger grey_production_before
  before insert or update on public.grey_fabric_production
  for each row execute function public.trg_grey_production_before();

-- ---------------------------------------------------------------------------
-- RPCs for shop-floor operations. These are SECURITY DEFINER so data_entry
-- users (who cannot UPDATE beams directly) can still load and finish beams.
-- ---------------------------------------------------------------------------
create or replace function public.load_beam(p_beam_id uuid, p_loom_id uuid)
returns public.beams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_beam public.beams;
  v_loom_factory uuid;
begin
  select * into v_beam from public.beams where id = p_beam_id for update;
  if not found then
    raise exception 'Beam not found' using errcode = 'WV004';
  end if;
  select factory_id into v_loom_factory from public.looms where id = p_loom_id;
  if not found then
    raise exception 'Loom not found' using errcode = 'WV002';
  end if;
  perform public.require_factory_access(v_beam.factory_id);
  perform public.require_factory_access(v_loom_factory);
  if v_beam.status <> 'prepared' then
    raise exception 'Beam % is % and cannot be loaded', v_beam.beam_no, replace(v_beam.status::text, '_', ' ')
      using errcode = 'WV004';
  end if;
  update public.beams
     set status = 'on_loom', loom_id = p_loom_id, loaded_at = now()
   where id = p_beam_id
  returning * into v_beam;
  return v_beam;
end;
$$;

create or replace function public.finish_beam(p_beam_id uuid)
returns public.beams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_beam public.beams;
begin
  select * into v_beam from public.beams where id = p_beam_id for update;
  if not found then
    raise exception 'Beam not found' using errcode = 'WV004';
  end if;
  perform public.require_factory_access(v_beam.factory_id);
  if v_beam.status <> 'on_loom' then
    raise exception 'Beam % is not on a loom', v_beam.beam_no using errcode = 'WV004';
  end if;
  update public.beams
     set status = 'finished', finished_at = now()
   where id = p_beam_id
  returning * into v_beam;
  return v_beam;
end;
$$;

-- Take-off from a loom: picks the loom's active beam automatically.
create or replace function public.record_takeoff(
  p_loom_id     uuid,
  p_meters      numeric,
  p_kgs         numeric,
  p_entry_date  date default null,
  p_shift       text default null,
  p_roll_no     text default null,
  p_notes       text default null,
  p_finish_beam boolean default false
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
begin
  select * into v_loom from public.looms where id = p_loom_id;
  if not found then
    raise exception 'Loom not found' using errcode = 'WV002';
  end if;
  perform public.require_factory_access(v_loom.factory_id);
  select id into v_beam_id from public.beams where loom_id = p_loom_id and status = 'on_loom' for update;
  if not found then
    raise exception 'Loom % has no beam running', v_loom.machine_no using errcode = 'WV004';
  end if;
  insert into public.grey_fabric_production (beam_id, loom_id, entry_date, shift, meters, kgs, roll_no, notes)
  values (v_beam_id, p_loom_id, coalesce(p_entry_date, public.ist_today()), p_shift, p_meters, p_kgs, p_roll_no, p_notes)
  returning * into v_row;
  if p_finish_beam then
    perform public.finish_beam(v_beam_id);
  end if;
  return v_row;
end;
$$;

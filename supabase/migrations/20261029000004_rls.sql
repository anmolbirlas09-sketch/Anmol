-- =============================================================================
-- 0004 · Row-level security, grants, realtime
--
--   owner       everything, all factories
--   supervisor  sees + adds + edits/deletes for their factory (or all if
--               app_users.factory_id is null)
--   data_entry  sees + adds for their factory; cannot edit or delete
--               (loading / finishing beams goes through the load_beam,
--               finish_beam and record_takeoff RPCs)
--
-- Yarn is a shared godown: every active user can see every lot and its full
-- consumption ledger, so lot balances are always correct.
-- =============================================================================

-- Helpers used in policies (security definer → no RLS recursion).
create or replace function public.beam_factory_id(p_beam_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select factory_id from public.beams where id = p_beam_id $$;

create or replace function public.loom_factory_id(p_loom_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select factory_id from public.looms where id = p_loom_id $$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated users go through RLS; anon gets nothing.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'factories', 'app_users', 'looms', 'yarn_qualities', 'fabric_qualities', 'suppliers',
    'app_settings', 'yarn_lots', 'beams', 'yarn_consumption', 'grey_fabric_production',
    'grey_fabric_dispatch', 'stock_adjustments', 'audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner-managed masters: factories, looms, settings
-- ---------------------------------------------------------------------------
create policy factories_select on public.factories for select to authenticated using (public.app_role() is not null);
create policy factories_write  on public.factories for all    to authenticated
  using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

create policy looms_select on public.looms for select to authenticated using (public.app_role() is not null);
create policy looms_write  on public.looms for all    to authenticated
  using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

create policy app_settings_select on public.app_settings for select to authenticated using (public.app_role() is not null);
create policy app_settings_write  on public.app_settings for all    to authenticated
  using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Shared masters: owner + supervisor may add/edit, only owner deletes
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['yarn_qualities', 'fabric_qualities', 'suppliers'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() is not null)', t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated with check (public.app_role() in ('owner', 'supervisor'))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (public.app_role() in ('owner', 'supervisor')) with check (public.app_role() in ('owner', 'supervisor'))$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated using (public.app_role() = 'owner')$p$, t || '_delete', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users: everyone sees active colleagues' names; only owner manages users.
-- ---------------------------------------------------------------------------
create policy app_users_select on public.app_users for select to authenticated
  using (id = auth.uid() or public.app_role() is not null);
create policy app_users_write on public.app_users for all to authenticated
  using (public.app_role() = 'owner') with check (public.app_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Yarn lots (shared visibility, factory-scoped writes)
-- ---------------------------------------------------------------------------
create policy yarn_lots_select on public.yarn_lots for select to authenticated using (public.app_role() is not null);
create policy yarn_lots_insert on public.yarn_lots for insert to authenticated with check (public.can_access_factory(factory_id));
create policy yarn_lots_update on public.yarn_lots for update to authenticated
  using (public.can_edit_factory(factory_id)) with check (public.can_edit_factory(factory_id));
create policy yarn_lots_delete on public.yarn_lots for delete to authenticated using (public.can_edit_factory(factory_id));

-- ---------------------------------------------------------------------------
-- Beams (factory-scoped)
-- ---------------------------------------------------------------------------
create policy beams_select on public.beams for select to authenticated using (public.can_access_factory(factory_id));
create policy beams_insert on public.beams for insert to authenticated
  with check (public.can_access_factory(factory_id) and status = 'prepared');
create policy beams_update on public.beams for update to authenticated
  using (public.can_edit_factory(factory_id)) with check (public.can_edit_factory(factory_id));
create policy beams_delete on public.beams for delete to authenticated using (public.can_edit_factory(factory_id));

-- ---------------------------------------------------------------------------
-- Yarn consumption (visible to all so lot balances are right; scoped writes)
-- ---------------------------------------------------------------------------
create policy yarn_consumption_select on public.yarn_consumption for select to authenticated using (public.app_role() is not null);
create policy yarn_consumption_insert on public.yarn_consumption for insert to authenticated
  with check (public.can_access_factory(public.beam_factory_id(beam_id)));
create policy yarn_consumption_update on public.yarn_consumption for update to authenticated
  using (public.can_edit_factory(public.beam_factory_id(beam_id)))
  with check (public.can_edit_factory(public.beam_factory_id(beam_id)));
create policy yarn_consumption_delete on public.yarn_consumption for delete to authenticated
  using (public.can_edit_factory(public.beam_factory_id(beam_id)));

-- ---------------------------------------------------------------------------
-- Grey production (factory = loom's factory)
-- ---------------------------------------------------------------------------
create policy grey_production_select on public.grey_fabric_production for select to authenticated
  using (public.can_access_factory(public.loom_factory_id(loom_id)));
create policy grey_production_insert on public.grey_fabric_production for insert to authenticated
  with check (public.can_access_factory(public.loom_factory_id(loom_id)));
create policy grey_production_update on public.grey_fabric_production for update to authenticated
  using (public.can_edit_factory(public.loom_factory_id(loom_id)))
  with check (public.can_edit_factory(public.loom_factory_id(loom_id)));
create policy grey_production_delete on public.grey_fabric_production for delete to authenticated
  using (public.can_edit_factory(public.loom_factory_id(loom_id)));

-- ---------------------------------------------------------------------------
-- Grey dispatch (factory-scoped)
-- ---------------------------------------------------------------------------
create policy grey_dispatch_select on public.grey_fabric_dispatch for select to authenticated using (public.can_access_factory(factory_id));
create policy grey_dispatch_insert on public.grey_fabric_dispatch for insert to authenticated with check (public.can_access_factory(factory_id));
create policy grey_dispatch_update on public.grey_fabric_dispatch for update to authenticated
  using (public.can_edit_factory(factory_id)) with check (public.can_edit_factory(factory_id));
create policy grey_dispatch_delete on public.grey_fabric_dispatch for delete to authenticated using (public.can_edit_factory(factory_id));

-- ---------------------------------------------------------------------------
-- Stock adjustments: supervisors/owner create (they are the approver);
-- only owner edits or deletes. Yarn adjustments are visible to all.
-- ---------------------------------------------------------------------------
create policy stock_adjustments_select on public.stock_adjustments for select to authenticated
  using ((item_type = 'yarn_lot' and public.app_role() is not null) or public.can_access_factory(factory_id));
create policy stock_adjustments_insert on public.stock_adjustments for insert to authenticated
  with check (public.can_edit_factory(factory_id));
create policy stock_adjustments_update on public.stock_adjustments for update to authenticated
  using (public.app_role() = 'owner') with check (public.app_role() = 'owner');
create policy stock_adjustments_delete on public.stock_adjustments for delete to authenticated
  using (public.app_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Audit log: owner reads; written only by trigger.
-- ---------------------------------------------------------------------------
create policy audit_log_select on public.audit_log for select to authenticated using (public.app_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes on the tables the dashboard listens to.
-- (Guarded so the migration also runs on plain Postgres.)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['looms', 'beams', 'yarn_lots', 'yarn_consumption', 'grey_fabric_production',
                             'grey_fabric_dispatch', 'stock_adjustments'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end;
$$;

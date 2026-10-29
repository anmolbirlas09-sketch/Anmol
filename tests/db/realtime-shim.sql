-- Test-only: stands in for Supabase Realtime's change feed. Every change on the
-- tables the dashboard listens to is announced with pg_notify, and the fake
-- gateway (tests/stack/fake-supabase.ts) forwards it to subscribed browsers.
-- NOT applied on Supabase, where the supabase_realtime publication does this.
create or replace function public.fake_realtime_notify()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify('fake_realtime', json_build_object(
    'table', tg_table_name,
    'type', tg_op,
    'id', coalesce(case when tg_op = 'DELETE' then old.id else new.id end, null)
  )::text);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['looms', 'beams', 'yarn_lots', 'yarn_consumption', 'grey_fabric_production',
                           'grey_fabric_dispatch', 'stock_adjustments'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.fake_realtime_notify()',
                   t || '_fake_realtime', t);
  end loop;
end;
$$;

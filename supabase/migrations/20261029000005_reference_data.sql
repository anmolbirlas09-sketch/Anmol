-- =============================================================================
-- 0005 · Reference data needed in every environment (production included):
--        2 factories, 68 looms, default settings.
-- Idempotent: safe to re-run.
-- =============================================================================

insert into public.factories (code, name, sort_order) values
  ('L-76', 'Factory L-76', 1),
  ('L-75', 'Factory L-75', 2)
on conflict do nothing;

-- L-76: L76-01 … L76-36   ·   L-75: L75-01 … L75-32
insert into public.looms (factory_id, machine_no, sort_order)
select f.id, replace(f.code, '-', '') || '-' || lpad(n::text, 2, '0'), n
from public.factories f
cross join lateral generate_series(1, case f.code when 'L-76' then 36 when 'L-75' then 32 end) n
where f.code in ('L-76', 'L-75')
on conflict do nothing;

insert into public.app_settings (key, value, description) values
  ('variance_threshold_pct', '5', 'Planned vs actual yarn variance (±%) above which a beam is flagged red')
on conflict (key) do nothing;

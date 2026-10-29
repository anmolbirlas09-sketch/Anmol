-- =============================================================================
-- 0008 · Production per day per loom (dashboard "today", reports later)
-- =============================================================================

create view public.v_production_daily with (security_invoker = true) as
  select p.entry_date, lm.factory_id, f.code as factory_code,
         p.loom_id, lm.machine_no,
         b.fabric_quality_id, fq.name as fabric_quality_name,
         count(*) as takeoff_count,
         sum(p.meters) as meters,
         sum(p.kgs) as kgs
  from public.grey_fabric_production p
  join public.beams b on b.id = p.beam_id
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  join public.fabric_qualities fq on fq.id = b.fabric_quality_id
  group by p.entry_date, lm.factory_id, f.code, p.loom_id, lm.machine_no, b.fabric_quality_id, fq.name;

grant select on public.v_production_daily to authenticated;

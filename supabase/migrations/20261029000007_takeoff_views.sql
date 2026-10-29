-- =============================================================================
-- 0007 · Views for loom loading, fabric take-off and grey stock screens (phase 3)
-- =============================================================================

-- Take-offs with beam, loom, quality and who entered them.
create view public.v_takeoffs with (security_invoker = true) as
  select p.id, p.entry_date, p.shift, p.meters, p.kgs, p.roll_no, p.notes, p.created_at,
         case when p.kgs > 0 then round(p.meters / p.kgs, 3) end as meters_per_kg,
         p.beam_id, b.beam_no, b.status as beam_status,
         p.loom_id, lm.machine_no, lm.factory_id, f.code as factory_code,
         b.fabric_quality_id, fq.name as fabric_quality_name,
         p.created_by, u.name as created_by_name
  from public.grey_fabric_production p
  join public.beams b on b.id = p.beam_id
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  join public.fabric_qualities fq on fq.id = b.fabric_quality_id
  left join public.app_users u on u.id = p.created_by;

grant select on public.v_takeoffs to authenticated;

-- Loom status gains the beam's expected fabric length and yarn used, so the
-- take-off screen can show progress and warn about implausible kg.
create or replace view public.v_loom_status with (security_invoker = true) as
  select lm.id as loom_id, lm.machine_no, lm.status, lm.active, lm.sort_order,
         lm.factory_id, f.code as factory_code,
         bs.beam_id, bs.beam_no, bs.loaded_at,
         bs.fabric_quality_id, bs.fabric_quality_name,
         bs.warp_length_m,
         bs.warp_kg, bs.weft_kg,
         bs.grey_meters as meters_on_beam,
         bs.grey_kg as kgs_on_beam,
         bs.expected_fabric_length_m,
         bs.total_yarn_kg
  from public.looms lm
  join public.factories f on f.id = lm.factory_id
  left join public.beams b on b.loom_id = lm.id and b.status = 'on_loom'
  left join public.v_beam_summary bs on bs.beam_id = b.id;

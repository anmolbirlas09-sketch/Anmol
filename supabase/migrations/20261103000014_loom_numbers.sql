-- =============================================================================
-- 0014 · Loom numbers 1–68 shown alongside the machine names
--
--   looms.loom_no: one number per loom across all sheds, unique.
--     Loom 1–32  = L75-01 … L75-32
--     Loom 33–68 = L76-01 … L76-36
--   (any other shed follows). Machine names (L76-05 …) and every past record
--   stay exactly as they are; the number is extra. New looms get the next
--   number; the owner can change it in Settings → Looms.
-- =============================================================================

alter table public.looms add column loom_no integer check (loom_no is null or loom_no > 0);

update public.looms l
   set loom_no = n.rn
  from (
    select l2.id,
           row_number() over (order by case f.code when 'L-75' then 0 when 'L-76' then 1 else 2 end,
                                       f.sort_order, f.code, l2.sort_order, l2.machine_no) as rn
    from public.looms l2 join public.factories f on f.id = l2.factory_id
  ) n
 where n.id = l.id;

create unique index looms_loom_no_key on public.looms (loom_no);
comment on column public.looms.loom_no is 'Loom number across the factory (Loom 1–68), shown next to the machine name';

create or replace function public.trg_loom_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.loom_no is null then
    perform pg_advisory_xact_lock(hashtextextended('loom_no', 0));
    select coalesce(max(loom_no), 0) + 1 into new.loom_no from public.looms;
  end if;
  return new;
end;
$$;
create trigger looms_a_loom_no before insert on public.looms
  for each row execute function public.trg_loom_no();

-- Views: the number travels with the loom (appended columns).
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
         bs.total_yarn_kg,
         bs.wasted_meters as wasted_on_beam,
         bs.net_meters as net_on_beam,
         bs.fabric_specification_id, bs.spec_code, bs.reed, bs.ends_per_inch,
         bs.warp_yarn_quality_name, bs.weft_yarn_quality_name,
         lm.fabric_specification_id as assigned_specification_id, asg.spec_code as assigned_spec_code,
         lr.counter_reading as last_counter_reading, lr.reading_at as last_reading_at, lr.entry_date as last_reading_date,
         lr.production_time as last_reading_time,
         bs.expected_finish_date, bs.total_ends, bs.picks_on_loom, bs.reed_space_in,
         lm.loom_no
  from public.looms lm
  join public.factories f on f.id = lm.factory_id
  left join public.beams b on b.loom_id = lm.id and b.status = 'on_loom'
  left join public.v_beam_summary bs on bs.beam_id = b.id
  left join public.fabric_specifications asg on asg.id = lm.fabric_specification_id
  left join lateral (
    select p.counter_reading, p.reading_at, p.entry_date, p.production_time
    from public.grey_fabric_production p
    where p.loom_id = lm.id and p.counter_reading is not null
    order by p.reading_at desc, p.created_at desc
    limit 1
  ) lr on true;

create or replace view public.v_takeoffs with (security_invoker = true) as
  select p.id, p.entry_date, p.shift, p.meters, p.kgs, p.roll_no, p.notes, p.created_at,
         case when p.kgs > 0 then round(p.meters / p.kgs, 3) end as meters_per_kg,
         p.beam_id, public.beam_label(b.beam_no, b.card_no) as beam_no, b.status as beam_status,
         p.loom_id, lm.machine_no, lm.factory_id, f.code as factory_code,
         p.fabric_quality_id, fq.name as fabric_quality_name,
         p.created_by, u.name as created_by_name,
         p.wasted_meters, p.net_meters, p.wastage_pct, p.roll_length_m,
         p.gsm, p.width_m, p.estimated_kg,
         p.warp_kg, p.weft_kg, p.total_yarn_kg,
         p.waste_kg, p.waste_pct_entered, p.waste_kg_estimated, p.weight_wastage_pct,
         (select count(*) from public.fabric_rolls r where r.production_id = p.id) as roll_count,
         p.fabric_specification_id, s.spec_code, coalesce(s.reed, b.reed) as reed, s.ends_per_inch,
         coalesce(sw.name, bw.name) as warp_yarn_quality_name, coalesce(sf.name, bf.name) as weft_yarn_quality_name,
         p.production_time, p.counter_reading, p.previous_reading, p.meters_source, p.counter_reset, p.reading_at,
         lm.loom_no
  from public.grey_fabric_production p
  join public.beams b on b.id = p.beam_id
  join public.looms lm on lm.id = p.loom_id
  join public.factories f on f.id = lm.factory_id
  left join public.fabric_qualities fq on fq.id = p.fabric_quality_id
  left join public.fabric_specifications s on s.id = p.fabric_specification_id
  left join public.yarn_qualities sw on sw.id = s.warp_yarn_quality_id
  left join public.yarn_qualities sf on sf.id = s.weft_yarn_quality_id
  left join public.yarn_qualities bw on bw.id = b.warp_yarn_quality_id
  left join public.yarn_qualities bf on bf.id = b.weft_yarn_quality_id
  left join public.app_users u on u.id = p.created_by;

create or replace view public.v_beam_loom_events with (security_invoker = true) as
  select e.id, e.beam_id, public.beam_label(b.beam_no, b.card_no) as beam_no, e.loom_id, l.machine_no, l.factory_id,
         e.event, e.at, e.seq, e.meters_so_far, e.created_by, u.name as created_by_name,
         l.loom_no
  from public.beam_loom_events e
  join public.beams b on b.id = e.beam_id
  join public.looms l on l.id = e.loom_id
  left join public.app_users u on u.id = e.created_by;

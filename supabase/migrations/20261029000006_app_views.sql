-- =============================================================================
-- 0006 · Views used by the app screens (phase 2)
-- =============================================================================

-- Consumption lines with the lot and person, for the beam screen.
create view public.v_consumption_lines with (security_invoker = true) as
  select c.id, c.beam_id, b.beam_no, c.yarn_lot_id, l.lot_no,
         l.yarn_quality_id, q.name as yarn_quality_name,
         c.usage_type, c.kgs, c.entry_date, c.created_at,
         c.created_by, u.name as created_by_name
  from public.yarn_consumption c
  join public.beams b on b.id = c.beam_id
  join public.yarn_lots l on l.id = c.yarn_lot_id
  join public.yarn_qualities q on q.id = l.yarn_quality_id
  left join public.app_users u on u.id = c.created_by;

-- Fabric qualities with their warp/weft yarn names, for pickers and masters.
create view public.v_fabric_qualities with (security_invoker = true) as
  select fq.*, w.name as warp_yarn_quality_name, f.name as weft_yarn_quality_name,
         w.denier as warp_denier, f.denier as weft_denier
  from public.fabric_qualities fq
  left join public.yarn_qualities w on w.id = fq.warp_yarn_quality_id
  left join public.yarn_qualities f on f.id = fq.weft_yarn_quality_id;

grant select on public.v_consumption_lines, public.v_fabric_qualities to authenticated;

-- Fix: the yarn ledger must list every movement of a lot, even when the
-- consuming beam belongs to a factory the viewer cannot see (left join, so the
-- row stays and only beam_no is hidden). Otherwise the ledger would not sum to
-- the lot balance for factory-scoped users.
create or replace view public.v_yarn_ledger with (security_invoker = true) as
  select l.id as yarn_lot_id, l.lot_no, l.yarn_quality_id, l.factory_id,
         l.inward_date as entry_date,
         case when l.is_opening then 'opening' else 'inward' end as movement_type,
         l.id as ref_id, null::uuid as beam_id, null::text as beam_no,
         l.kgs_received as kgs, l.challan_no as reference, l.created_at
  from public.yarn_lots l
  union all
  select c.yarn_lot_id, l.lot_no, l.yarn_quality_id, l.factory_id,
         c.entry_date, c.usage_type::text, c.id, b.id, b.beam_no,
         -c.kgs, null, c.created_at
  from public.yarn_consumption c
  join public.yarn_lots l on l.id = c.yarn_lot_id
  left join public.beams b on b.id = c.beam_id
  union all
  select a.yarn_lot_id, l.lot_no, l.yarn_quality_id, l.factory_id,
         a.entry_date, 'adjustment', a.id, null, null,
         a.kgs, a.reason, a.created_at
  from public.stock_adjustments a
  join public.yarn_lots l on l.id = a.yarn_lot_id
  where a.item_type = 'yarn_lot';

-- =============================================================================
-- Sample masters for local development and the acceptance tests.
-- (Factories, looms and settings come from migration 0005.)
-- Denier for 0.25 mm HDPE monofilament ≈ 420.
-- =============================================================================

insert into public.yarn_qualities (name, denier, material, color, reorder_level_kg) values
  ('Mono 0.25 White', 420, 'HDPE monofilament', 'White', 200),
  ('Mono 0.25 Black', 420, 'HDPE monofilament', 'Black', 200),
  ('Mono 0.30 Green', 600, 'HDPE monofilament', 'Green', 100),
  ('PP Multifilament 1500D Natural', 1500, 'PP multifilament', 'Natural', 100)
on conflict do nothing;

insert into public.fabric_qualities
  (name, warp_yarn_quality_id, weft_yarn_quality_id, total_ends, reed_width_m, picks_per_inch,
   warp_crimp_pct, weft_wastage_pct, gsm, notes)
select v.name, w.id, f.id, v.ends, v.reed, v.ppi, v.crimp, v.wastage, v.gsm, v.notes
from (values
  ('Mono White',  'Mono 0.25 White', 'Mono 0.25 White', 1800, 1.80, 24, 3.0, 2.0, 150, 'Warp and weft same yarn'),
  ('White/Black', 'Mono 0.25 White', 'Mono 0.25 Black', 1800, 1.80, 24, 3.0, 2.0, 150, 'White warp, black weft'),
  ('Green Shade Net', 'Mono 0.30 Green', 'Mono 0.30 Green', 1200, 2.00, 16, 2.5, 2.0, 120, null)
) v(name, warp, weft, ends, reed, ppi, crimp, wastage, gsm, notes)
join public.yarn_qualities w on w.name = v.warp
join public.yarn_qualities f on f.name = v.weft
on conflict do nothing;

insert into public.suppliers (name, gstin, contact) values
  ('Sample Yarn Suppliers Pvt Ltd', '24AAAAA0000A1Z5', 'Surat')
on conflict do nothing;

-- One specification per sample quality (reed, ends per inch, warp and weft yarn).
insert into public.fabric_specifications (fabric_quality_id, seq, spec_code, reed, ends_per_inch, warp_yarn_quality_id, weft_yarn_quality_id)
select fq.id, 0, '', v.reed, v.epi, w.id, f.id
from (values
  ('Mono White',      48, 52, 'Mono 0.25 White', 'Mono 0.25 White'),
  ('White/Black',     48, 52, 'Mono 0.25 White', 'Mono 0.25 Black'),
  ('Green Shade Net', 40, 44, 'Mono 0.30 Green', 'Mono 0.30 Green')
) v(quality, reed, epi, warp, weft)
join public.fabric_qualities fq on fq.name = v.quality
join public.yarn_qualities w on w.name = v.warp
join public.yarn_qualities f on f.name = v.weft
where not exists (select 1 from public.fabric_specifications s where s.fabric_quality_id = fq.id);

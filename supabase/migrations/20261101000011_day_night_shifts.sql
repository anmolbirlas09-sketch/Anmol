-- =============================================================================
-- 0011 · Two shifts: day (8 am – 8 pm) and night (8 pm – 8 am)
-- Replaces the placeholder list (day, night, A, B, C). Existing data only uses
-- 'day' or no shift, so no rows change.
-- =============================================================================
alter table public.grey_fabric_production drop constraint grey_fabric_production_shift_check;
alter table public.grey_fabric_production
  add constraint grey_fabric_production_shift_check check (shift is null or shift in ('day', 'night'));

comment on column public.grey_fabric_production.shift is
  'day = 8 am – 8 pm; night = 8 pm – 8 am, dated by the day the night shift starts';

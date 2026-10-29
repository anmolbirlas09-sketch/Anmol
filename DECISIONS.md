# Decisions & assumptions

Choices made where the brief left room. Each one is easy to change — tell me if any is wrong for how the floor actually works.

## Stack
- **Next.js + Supabase + Tailwind, as specified.** No reason to deviate.
- **Business rules live in Postgres** (triggers, constraints, RPCs), not just the UI, so a phone with a stale screen, two supervisors entering at once, or a future import script can't break stock.

## Inventory model
1. **Ledger only, no stored balances.** Inward, consumption, production, dispatch and adjustments are rows; every balance is a view that sums them.
2. **Yarn is one shared godown.** Lots are received at a factory (`yarn_lots.factory_id`), but any beam in either factory can draw from any lot. Every active user can see every lot and its full consumption, so lot balances are always correct whatever the user's factory.
3. **Yarn quality is not forced to match the fabric quality.** The DB lets you draw warp/weft from any lot (substitutes happen); the beam screen will warn when a lot's yarn quality differs from the fabric quality's warp/weft yarn.
4. **Grey stock is held per fabric quality per factory.** Production counts at the loom's factory; dispatch and grey adjustments carry a `factory_id`. Dispatch (and deleting/editing a take-off) is blocked if it would make that quality's stock at that factory negative, in meters or kg.
5. **Adjustments are signed** (`+` adds, `−` removes) and need a reason. For yarn, the adjustment's factory is copied from the lot. **Opening stock:** yarn = a `yarn_lots` row with `is_opening = true`; grey = a `stock_adjustments` row with `is_opening = true`.
6. **Polymorphic `ref_id` replaced by two real foreign keys** on `stock_adjustments` (`yarn_lot_id` / `fabric_quality_id`) plus a check that exactly the right one is set.
7. **Future "Grey → Finish" stage:** it will be another outward movement from grey stock (like dispatch) feeding a new finished-stock ledger; `v_grey_ledger` already unions movement types, so adding one is a new `union all` branch.

## Beams & looms
8. **Beam state machine:** `prepared → on_loom → finished`. A beam can go back from `on_loom` to `prepared` (unloaded by mistake) only if it has no take-offs yet.
9. **One active beam per loom** is enforced three ways: a row lock on the loom while loading, a trigger that raises a readable error, and a partial unique index (`beams_one_active_per_loom`) as a race-proof backstop.
10. **`beams.factory_id`** (not in the brief) records where the beam is; it is set to the loom's factory when loaded. This lets supervisors see beams that are prepared but not yet on a loom.
11. **Loom status is derived.** `running` is set/cleared automatically from the beam on it. Users can only toggle an empty loom between `idle` and `maintenance`, or deactivate it. A running loom cannot be put into maintenance or deactivated.
12. **Take-off goes through `record_takeoff(loom)`**, which finds the loom's running beam, so the operator never picks the beam. The "mark beam finished" option runs in the same transaction.
13. **No beam-move history yet.** A beam runs on one loom; production rows store `loom_id` so per-loom history is kept. If beams are ever moved mid-run, add a `beam_loadings` table.

## Planned consumption (§4)
14. **Fabric length for planned weft** = `warp_length_m ÷ (1 + warp_crimp_pct/100)` — the fabric a beam is expected to yield. This keeps "planned" stable while the beam runs. Actual meters produced are shown separately.
15. **Variance flag** compares `|variance %|` to `app_settings.variance_threshold_pct` (default 5). If any input is missing, planned and variance are `null` (UI shows "—") and actual entry is still allowed.
16. **Sample denier:** 0.25 mm HDPE monofilament ≈ 420 denier. Sample qualities in `seed.sql` are placeholders — replace with real masters.

## Users, roles, security
17. **`app_users`** (named to avoid clashing with Supabase's `auth.users`) holds role and factory; `factory_id = null` means all factories.
18. **First sign-up becomes the owner**; later sign-ups are inactive `data_entry` until the owner activates them. Inactive users see nothing.
19. **Role matrix (enforced with RLS):**

    | | owner | supervisor | data_entry |
    |---|---|---|---|
    | See | all | own factory (+ all yarn) | own factory (+ all yarn) |
    | Add entries | all | own factory | own factory |
    | Edit / delete entries | all | own factory | — |
    | Stock adjustments | create, edit, delete | create (own factory) | — |
    | Yarn/fabric qualities, suppliers | full | add, edit | — |
    | Factories, looms, settings, users | full | — | — |
    | Audit log | read | — | — |

    Loading, finishing and take-off are *operations*, not edits, so data_entry users do them through the `load_beam` / `finish_beam` / `record_takeoff` RPCs (which check factory access themselves).
20. **"Service context"** (migrations, SQL editor, service-role key, tests) is treated as owner. Plain `anon` gets no access to anything.
21. **`entered_by` → `created_by`.** Every table has `created_at / created_by / updated_at / updated_by`, stamped by trigger from the logged-in user (cannot be spoofed). Every insert, update and delete is copied to `audit_log` with old and new values.
22. **Concurrency:** stock checks lock the lot row (yarn) or an advisory lock per quality+factory (grey) and re-sum the ledger, assuming READ COMMITTED (Supabase/PostgREST default). Tested with two simultaneous connections racing for the last kg.

## Units & formats
23. kg are `numeric(14,3)`, meters `numeric(14,2)`; Postgres rounds on insert. Entry dates default to today in **Asia/Kolkata**; timestamps are `timestamptz`. DD-MM-YYYY is a display concern (UI phases).
24. Lot, beam and machine numbers are unique **case-insensitively** (`a-101` = `A-101`).
25. Shift is optional and limited to `day`, `night`, `A`, `B`, `C` — tell me your actual shift names.

## Testing
26. Tests run against a **real Postgres**, not mocks, with a small shim for Supabase's `auth.uid()` and roles. Each test file clones a freshly migrated template database.

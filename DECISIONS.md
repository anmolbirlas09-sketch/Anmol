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

## App (phase 2)
27. **Server Components + Server Actions** for everything; the browser never talks to the database directly yet (realtime arrives in phase 4). Every query lives in `src/lib/data/` and takes a Supabase client, so the same functions run in the app and in tests.
28. **Supabase publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) is the default; the legacy anon key is accepted too. Session cookies are refreshed in `src/proxy.ts` (Next 16's name for middleware).
29. **Sign-in is email + password.** Phone OTP can be added later in Supabase without changing the app's data model.
30. **Lot and beam numbers are upper-cased** on entry (`a-101` → `A-101`).
31. **Masters (yarn qualities, fabric qualities, suppliers) were added in phase 2** because inward and beam creation need them. Factories, looms, users and settings stay for phase 5 (roles).
32. **Available kg is checked three times:** the lot list on page load, a fresh balance fetched the moment a lot is picked, and finally the database on save. If someone else used the yarn in between, the save is refused with the database's message (tested with two browsers).
33. **Deleting a consumption line** (supervisor/owner) is allowed so mistakes can be fixed; it is logged in `audit_log`. Editing a line = delete + add.
34. **Factory-scoped users see every movement on a yarn lot**, but not the beam number of another factory's beam (`v_yarn_ledger` fix in migration 0006). The lot history therefore always adds up to the balance.
35. **Date inputs** use the phone's native date picker, which shows the phone's own format (DD/MM/YYYY on Indian-English phones). Everything the app prints is DD-MM-YYYY.
36. **Stock of a quality at zero** still shows its card with a low-stock badge, so running out is visible.

## Looms, take-off, grey (phase 3)
38. **Bottom navigation** is Home · Yarn · Beams · Looms · Grey. Masters moved to Home (and the header on wider screens) to keep five large tabs.
39. **Take-off is the main shop-floor action**, so it is the first button on Home and on the Looms page. Picking a loom fills in its beam; the form keeps loom, date and shift for the next roll and clears meters, kg and roll no.
40. **Plausibility hints, not blocks:** the take-off form shows m/kg as you type, meters so far vs the beam's expected fabric length, and warns if grey kg would exceed the yarn used on the beam. None of these stop a save, because the scale reading is the truth.
41. **Loading:** L-76 / L-75 staff see only their own factory's free looms. The owner sees all, with the beam's own factory listed first. Loading onto a loom in another factory moves the beam there (decision 10).
42. **Corrections:** a supervisor can *unload* a beam put on the wrong loom (only before any take-off), and *delete* a take-off (refused if that fabric was already dispatched, see decision 4). Data-entry users can do neither.
43. **Loom tiles in phase 3 are refreshed on navigation**; live updates without refresh come with the phase 4 dashboard.
44. **Shift names** are still placeholders (Day, Night, A, B, C) until you confirm yours.

## Dashboard & realtime (phase 4)
45. **Home is the dashboard.** Owners start on "All"; factory staff start on their own factory and can switch.
46. **Realtime is a "something changed" signal.** The page subscribes to changes on the stock tables and, on any change, re-renders on the server (debounced 0.4 s). Numbers are always read again through RLS, so a realtime message can never show someone data they may not see, and no stock arithmetic happens in the browser.
47. **Phones sleep and drop websockets,** so pages also refresh when they come back into view. The status dot shows Live / Connecting / Not live.
48. **Live pages:** Dashboard, Looms, Grey, Yarn list, Beams list. Entry forms (take-off, beam, inward) are not auto-refreshed while someone is typing; the database still checks stock on save.
49. **Tapping a loom on the dashboard opens a sheet** (beam, quality, meters/kg so far, expected length, warp/weft kg) instead of navigating away. Take-off / Load buttons appear only for looms in the user's own factory.
50. **Yarn with a factory selected** shows lots *received at* that factory. Low-stock badges show only on "All", because reorder levels are set per quality across both factories (yarn is shared, decision 2).
51. **"Today"** is the take-off entry date in Asia/Kolkata, not the time it was typed in.
52. Sample qualities in `seed.sql` that have a low-stock level but no lots show as low stock (0 kg). Set their level to 0, or deactivate them, if they are not used.

## Dispatch, reports, import, settings (phase 5)
53. **Dispatch is per factory.** You pick the factory first; the quality list shows only what is in stock there, with m and kg. The form stops you going over the stock; the database refuses it anyway (WV003), for meters *and* kg.
54. **Adjustments** (yarn lot: ±kg; grey: ±m and ±kg) need a reason and are made by a supervisor or the owner, who is recorded as approver. Stock can't be adjusted below zero.
55. **Reports are computed in the database** (security-invoker functions, so RLS still applies) and long lists are fetched in pages, so nothing is silently cut off at Supabase's 1,000-row API limit (tested with 1,200 lots).
56. **One report model → three outputs.** Each report is built once as a table; the screen, Excel and PDF all render that same table, so they never disagree. Excel keeps real numbers and dates so totals and filters work in Excel.
57. **Report periods:** opening = before *From*; closing = up to *To*. Beam register and variance list beams *created* in the period. Defaults: this month to date, the user's own factory.
58. **Excel import is check-then-import.** The file is validated row by row (row numbers match Excel). Import re-reads and re-checks the file on the server, rather than trusting rows sent back from the browser, and inserts everything in one statement (all or nothing). Lot numbers that appear after the check (another user) make the whole batch fail rather than half-import.
59. **Opening yarn = yarn lots marked `is_opening`; opening grey = adjustments marked `is_opening`.** They show as "Opening stock" in ledgers and reports.
60. **Settings are owner-only** (UI and RLS). The owner can't remove their own owner role or deactivate themselves. Looms: status can only be set to idle or maintenance by hand; a running loom can't be deactivated (DB rule).
61. **Navigation:** six tabs (Home, Yarn, Beams, Looms, Grey, More). More holds Dispatch, Reports, Take-off, Import, Masters and Settings, filtered by role. Wider screens show Dispatch and Reports in the header.
62. **Forms keep what was typed or saved.** React resets a form after each submit and dropdowns/checkboxes snap back to their first values, so forms remount with the values they should show (found by the Settings and inward tests).
63. **Libraries:** `exceljs` (Excel read/write; its `uuid` dependency is pinned to a fixed version via `overrides`) and `jspdf` + `jspdf-autotable` (PDF).

## Testing
26. Tests run against a **real Postgres**, not mocks, with a small shim for Supabase's `auth.uid()` and roles. Each test file clones a freshly migrated template database.
37. **Fake Supabase gateway for app tests.** Running Supabase locally needs Docker, which isn't available here, so `tests/stack/fake-supabase.ts` implements GoTrue's password flow and the PostgREST subset the app uses, executing each request as the JWT's role with `request.jwt.claims` set. This keeps RLS, triggers and error codes real. It is not verified against real PostgREST: the first deploy to a Supabase project should include a quick click-through.

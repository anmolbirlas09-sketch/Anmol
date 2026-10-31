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
25. Shift is optional: `day` (8 am – 8 pm) or `night` (8 pm – 8 am), see decision 44.

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
44. **Shifts** are Day (8 am – 8 pm) and Night (8 pm – 8 am) (migration 0011). The production form pre-selects the shift running now in Asia/Kolkata. A night-shift entry made after midnight is dated by the evening the shift started (an entry at 2 am on the 2nd belongs to the night shift of the 1st); staff can change the date or shift.

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

## Metre-first production (migration 0010)
64. **Production is recorded in metres first.** Each entry needs the loom, fabric quality, total production metres, roll length and the wasted metres (0 allowed). Net usable metres and wastage % are calculated by the database (generated columns), so they can never disagree with the inputs.
65. **The old "wastage = yarn used − fabric weight" is removed** (it was §8 step 7: 700 − 650 = 50 kg). That difference is not wastage: fabric wastage is what staff record in metres, and KG wastage only what was measured (or given as a %). The §8 tests were changed to match.
66. **Metre wastage and KG wastage are independent.** KG wastage is asked only after a KG figure (warp, weft or weighed fabric) is entered. Staff enter either the measured waste kg (→ weight wastage % of total yarn) or a % (→ estimated waste kg, only when both warp and weft kg are known), not both. Measured waste kg cannot exceed the yarn used.
67. **Estimated vs actual weight.** Estimated fabric kg = GSM × width (m) × total production metres ÷ 1000, only when both GSM and width are entered; it is labelled *estimated* everywhere and never copied into the weighed weight. The weighed kg (the old take-off kg) is now optional and labelled *actual*. GSM and width are not pre-filled; the quality master's GSM is shown as a hint.
68. **Missing values stay NULL.** Report totals and dashboard figures add up only what was recorded and show "—" when nothing was, never 0.
69. **Production stays tied to the beam running on the loom** (as before). The fabric quality is pre-selected from that beam and must match it; a mismatch is refused.
70. **Rolls are created from the net usable metres** at the standard roll length; the last roll takes the remainder (680 − 33 = 647 m at 100 m → 6 × 100 + 47). Roll numbers are `<loom>-<YYMMDD>-<nn>`, numbered per loom per day. The roll total must equal the net metres; the database checks this when the transaction commits.
71. **Grey stock counts net usable metres** (wasted fabric is not stock). Grey kg stock adds up weighed fabric only. The "not more than in stock" rule always applies to metres, and to kg only when every production entry of that quality at that factory was weighed (otherwise kg stock is unknown). Dispatch kg is optional.
72. **Warp/weft kg on a production entry are information for wastage figures.** Yarn stock still moves only through the beam's yarn lines from lots, so nothing is deducted twice. Beam reports show both: *yarn issued to beam* and *yarn recorded at production*.
73. **Duplicate entries:** each form submission carries a one-time reference (`client_ref`); sending the same one twice (double tap, retry on a bad connection) returns the first entry instead of creating a second.
74. **Existing records are kept.** Entries made before 0010 get 0 wasted metres (so net = total and stock does not change), their fabric quality from the beam, and no rolls. The old `record_takeoff()` remains for compatibility; the app uses `record_production()`.
75. **Filters:** the production register, roll tracking, loom-wise production, beam register and variance reports can be narrowed by loom, fabric quality and beam number, as well as date and factory.

## Parent qualities and specifications (migration 0012)
76. **A fabric quality is a parent; it can have any number of specifications.** Each specification has its own Reed, Total Ends per Inch, warp yarn and weft yarn. Reed and ends per inch are separate numbers that are never calculated from each other. Warp and weft may be the same yarn or different.
77. **Specification ID** is generated: the parent's name in letters/digits + `-S` + a running number per parent (`QUALITY101-S2`). If two parent names reduce to the same letters (e.g. "S-813A A/S" and "s-813a/as"), the second gets a number (`S813AAS2-S1`). The ID never changes, even if the parent is renamed.
78. **Duplicates:** the same parent cannot have two specifications with the same reed, ends per inch, warp and weft (blank counts as a value). Any difference makes a new specification.
79. **Everything that holds stock carries the exact specification:** beams, production entries, dispatches and grey adjustments, enforced by a composite foreign key, so a specification can never be paired with another parent. Rolls and yarn consumption reach their specification through their production entry or beam. Grey stock is kept per specification per factory; a dispatch can only use its own specification's stock, even if the parent has more in other specifications. Parent reports add the specifications up.
80. **The beam decides the specification at the loom.** Production entries pick the parent quality and specification (pre-filled from the beam on the loom) and are refused if they don't match the beam. A loom can also be *set up for* one specification in Settings → Looms (the reed fitted on it); then only beams of that specification can be loaded. Looms without a setting accept any specification. The 68 looms are unchanged.
81. **History is protected:** once a specification has beams, its reed, ends per inch and yarns are fixed (blank values can be filled in once). Use a new specification for a different combination. Notes can change, and a specification can be **deactivated**: it disappears from new beams and pickers but its production, stock and reports stay.
82. **Existing data:** each existing quality got one specification (S1) with its current warp/weft yarns; reed and ends per inch start blank to be filled in (they were not recorded before). All existing beams, production, rolls and stock belong to that S1, unchanged. Two existing qualities ("S-813A A/S" and "s-813a/as") look like variations of one quality; they were left as they are.
83. **Planned yarn** uses the specification's warp/weft yarn deniers (falling back to the parent's yarns); total ends, reed width, PPI and crimp stay on the parent.
84. **Older entry points still work** when a parent has exactly one active specification (it is filled in automatically, e.g. opening-stock imports without a Specification ID). With more than one, the specification must be chosen.
85. **Reports:** a *Specification and quality summary* lists each parent with a totals row and its specifications underneath (or parents only), and every fabric report shows and filters by specification.

## Digital beam card and time-stamped production (migration 0013)
86. **Every field a person types on a beam card is optional** — beam number, beam making date, fabric quality, specification, shed, counter meter and all other card fields. A card can be saved completely empty and completed later; nothing is filled with an invented value (blank = NULL). Only system values are required: the id, the card number and the status.
87. **Card number:** each beam gets a system number; a beam without a beam number is shown as `CARD-12` and can be searched by it. Beam numbers stay unique when given.
88. **The 20 card fields:** beam number, making date, fabric quality number (identification); warp, reed, total number of ends, reed space (inches), weft, on-loom picks (specifications); counter meter, rolling meter, warp weight, G.W., F.W., weft weight (measurements); weave; beam getting date, finish date expected / actual; loom number. *Counter meter* is the existing beam length column (`warp_length_m`), so older beams show their length there. When a specification is chosen, the card's reed / warp / weft come from it (a *new specification* can be created from the card, or an identical existing one is reused); otherwise they are stored on the card. Total ends, picks and reed space are beam values; planned yarn kg uses them first, then the parent quality's.
89. **Quality filled in later:** production recorded on a beam with no quality/specification is kept and shown in grey stock as *Quality not set*; it cannot be dispatched. When the card is completed, that production moves to the quality/specification. Once production exists, a filled-in quality or specification can no longer be changed.
90. **Shed:** a beam is at the shed of the loom it is loaded on. Factory-scoped staff always save at their own shed; the owner may leave it blank (*not at a shed yet*), and such beams are visible only to the owner and all-factory users until loaded.
91. **Loading, unloading, replacing:** one active beam per loom (unchanged rule). Loading onto a busy loom asks what happens to the running beam: *finished*, or *taken off unfinished* (it keeps its production and can be loaded again later, on any loom). As before, only an owner or supervisor may unload a beam; data entry may load and finish. A finished beam with production cannot be reopened. Every load, unload and finish is recorded in `beam_loom_events` (back-filled for existing beams) and shown on the beam card and the loom page. Editing a saved card is for owners and supervisors (the existing edit rights).
92. **Production time:** each entry can carry the actual time the reading was taken (prefilled with the current time, editable, can be cleared). There are no fixed intervals, reminders or pop-ups. If no shift is chosen it follows the time (day 08:00–20:00, night otherwise). A night-shift time before 08:00 belongs to the morning after the shift date. Entries without a time are placed at the moment they were entered.
93. **Counter readings:** *production metres = current reading − the loom's previous reading* (same loom, any beam, by date and time), only when a previous reading exists, the counter was not reset and the metres were not typed in (typed metres win). Without a previous reading nothing is invented: the reading is saved as the baseline and metres stay blank unless typed. A reading lower than the previous one is refused unless marked *counter reset / meter replaced*, which starts a new series. Earlier entries are never recalculated when a late reading is added.
94. **An entry needs production metres or a counter reading;** wasted metres (blank = none) and roll length (blank = no rolls) are optional, as are all weights.
95. **Production follows the active beam:** the loom's beam fills in the beam number, quality, specification, reed, ends per inch and yarns; staff do not choose them. A beam with missing card details still takes production.
96. **Reports:** the production register shows date, actual time, counter reading, previous reading and whether metres were typed or worked out from the counter. New *Daily production* (per day by all looms — every loom listed for a single day — or by quality, specification or beam) and *Shift-wise production* (day / night / no shift per loom, with totals). Time-of-day and shift filters on the production, loom-wise, daily and shift reports.

## Testing
26. Tests run against a **real Postgres**, not mocks, with a small shim for Supabase's `auth.uid()` and roles. Each test file clones a freshly migrated template database.
37. **Fake Supabase gateway for app tests.** Running Supabase locally needs Docker, which isn't available here, so `tests/stack/fake-supabase.ts` implements GoTrue's password flow and the PostgREST subset the app uses, executing each request as the JWT's role with `request.jwt.claims` set. This keeps RLS, triggers and error codes real. It is not verified against real PostgREST: the first deploy to a Supabase project should include a quick click-through.

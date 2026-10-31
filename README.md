# Weaving Inventory — Yarn → Beam → Loom → Grey Fabric

A live, shared inventory system for a weaving unit in Surat with two factories (L-76: 36 looms, L-75: 32 looms). It tracks yarn lots from inward, through warp/weft consumption on beams, beams on looms, and grey fabric take-off, dispatch and stock.

**Stack:** Next.js (App Router, TypeScript) + Supabase (Postgres, Auth, Realtime) + Tailwind, deployable on Vercel.

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema, seed, stock views, DB-enforced rules, RLS | ✅ done |
| 2 | Sign-in, yarn inward, beam creation, warp/weft consumption, masters | ✅ done |
| 3 | Loom loading, fabric take-off, grey stock, loom grid | ✅ done |
| 4 | Live dashboard, loom grid with detail sheet, realtime updates | ✅ done |
| 5 | Dispatch, adjustments, reports with Excel/PDF export, opening-stock Excel import, owner settings (users, looms, factories, threshold) | ✅ done |

## Screens

| Path | What it does |
|---|---|
| `/login`, `/signup`, `/pending` | Email + password sign-in; new accounts wait for the owner to activate them |
| `/` | **Dashboard** (live): yarn stock, grey stock (m + kg), looms running / idle of 68, today's production; All / L-76 / L-75 toggle; loom grid (tap a tile → sheet with beam, quality, meters so far, warp/weft kg, Take-off / Load); grey stock and yarn stock tables with low-stock badges |
| `/yarn` | Lots with live balance; stock-by-quality cards (tap to filter), factory toggle, search, "show used-up lots" |
| `/yarn/new` | Yarn inward: lot no, quality, kg, factory, supplier, challan, bags/cones, rate. "Save + new" for several lots |
| `/yarn/[id]` | One lot: received / warp / weft / balance and every movement with a running balance |
| `/beams` | Beams with status filter, search by beam no / card no / quality / Spec ID / loom, quality and loom filters, warp/weft kg (red when over the variance limit) |
| `/beams/new` | **Load new beam** — the digital beam card: 20 fields in 7 groups (identification, quality & specification, warp & weft, measurements & weight, weaving, dates, loom). Every field optional; pick a loom to load it straight away (a busy loom asks whether its running beam is finished or taken off) |
| `/beams/[id]` | Beam card (all 20 fields, how many are still missing), edit / complete it (`/beams/[id]/edit`), status with load / unload / finish, loading & unloading history, planned vs actual, yield, production history with times and counter readings, add warp/weft lines lot by lot |
| `/masters/...` | Yarn qualities, suppliers, and **fabric qualities with their specifications**: each parent quality lists its specifications (Specification ID, Reed, Total Ends per Inch, warp and weft yarn); add, edit, deactivate; search by quality name or Specification ID |
| `/looms` | All 68 looms as tiles by factory (green = running, with beam and meters so far); factory toggle |
| `/looms/load` | Load a saved beam on a loom (beam's factory listed first); a busy loom asks what happens to its running beam |
| `/looms/[id]` | One loom: current beam and its card details, production form, "Mark beam finished", "Unload" (owner / supervisor), *Load new beam* / replace, recent production, beams-on-this-loom history |
| `/takeoff` | **Production entry (metre-first, time-stamped):** loom → its active beam's quality, specification, reed, ends and yarns shown automatically → date + actual time (prefilled, editable, optional) → counter reading (metres = current − previous reading) and/or production metres → optional roll length and wasted metres. Older description: 1 loom + fabric quality → 2 total metres → 3 roll length → 4 "How many metres of fabric were wasted?" → 5 net usable m and wastage % shown live, with the roll split → 6 optional weights (GSM + width → *estimated* kg, *actual* weighed kg, warp/weft kg; then measured waste kg **or** wastage %) → 7 save (rolls created, stock updated) |
| `/grey` | Grey stock (m and kg) by fabric quality with the factory split; factory toggle; Dispatch button |
| `/dispatch` | Grey dispatch: factory → quality (shows stock there), meters + kg, party, challan, rolls; blocks more than in stock; recent dispatches |
| `/grey/adjust`, lot page | Signed stock adjustments with a reason (supervisor / owner) |
| `/reports` | Date range + factory (+ daily/monthly, time-of-day, shift, group-by) filters; daily, shift-wise and the other reports, each on screen and as **Excel** and **PDF** |
| `/import` | Opening yarn / grey stock from .xlsx: download template → check file (problems listed by row) → import all-or-nothing |
| `/settings` | Owner only: users (activate, role, factory), looms (rename, maintenance, deactivate, add), factories, variance threshold |
| `/more` | Dispatch, Reports, Take-off, Import, Masters, Settings (by role) |

**Live updates:** the dashboard, Looms, Grey, Yarn and Beams pages listen to Supabase Realtime and refresh themselves within about half a second of anyone saving an entry (a green "Live" dot shows the connection). They also refresh when a phone is unlocked or the tab comes back into view.

All labels are in `src/lib/labels.ts`; formatting (kg 3 dp, m 2 dp, DD-MM-YYYY, IST) in `src/lib/format.ts`; every Supabase query in `src/lib/data/`.

## Repository layout

```
src/
  app/                        Next.js App Router pages + server actions
  components/                 UI kit (inputs, searchable Combobox, nav)
  lib/                        labels, format, validation, errors, planning, data access
  proxy.ts                    session refresh + sign-in redirect
supabase/
  migrations/
    …0001_core_schema.sql     tables, enums, created_*/updated_* stamps, audit_log
    …0002_integrity.sql       stock checks, one-beam-per-loom, state rules, RPCs
    …0003_views.sql           ledgers, balances, planned vs actual, loom status
    …0004_rls.sql             roles, row-level security, grants, realtime
    …0005_reference_data.sql  2 factories, 68 looms, default settings (all envs)
    …0006_app_views.sql       views for the screens; fixes v_yarn_ledger for factory-scoped users
    …0007_takeoff_views.sql   v_takeoffs; v_loom_status gains expected length + yarn used
    …0008_dashboard_views.sql v_production_daily (per day, loom, quality)
    …0009_reports.sql         report functions (yarn by quality/lot, grey summary, loom production), v_dispatches
    …0010_metre_first_production.sql  metre-first production: wasted/net metres, rolls, optional weights, KG wastage, record_production()
    …0011_day_night_shifts.sql        shifts: day (8 am – 8 pm) and night (8 pm – 8 am)
    …0012_fabric_specifications.sql   parent qualities with multiple specifications; stock per specification
    …0013_beam_cards_timed_production.sql   digital beam card (all fields optional), loading history, production time + counter readings
  seed.sql                    sample yarn/fabric qualities + supplier (dev/test)
tests/db/                     database tests against real Postgres (incl. §8)
tests/unit/                   formatting, validation, planning, error messages
tests/app/                    data layer via supabase-js → fake gateway → Postgres + RLS
tests/e2e/                    Playwright, phone-sized browser, the real Next.js app
tests/stack/                  fake Supabase gateway (auth + PostgREST subset) for tests
scripts/start-local-postgres.sh
templates/                    Excel import templates (opening yarn / grey stock)
DECISIONS.md                  assumptions and design choices
```

## Database at a glance

**Tables:** `factories`, `looms`, `yarn_qualities`, `fabric_qualities`, `suppliers`, `app_users`, `app_settings`, `yarn_lots`, `beams`, `yarn_consumption`, `grey_fabric_production`, `grey_fabric_dispatch`, `stock_adjustments`, `audit_log`.

**Views (balances always computed from the ledgers):**

| View | Answers |
|---|---|
| `v_yarn_lot_balance` | kg per lot: received, warp/weft consumed, adjusted, balance |
| `v_yarn_stock_by_quality` | kg per yarn quality, with `is_low_stock` |
| `v_yarn_stock_by_quality_factory` | the same, split by receiving factory |
| `v_yarn_ledger` | every yarn movement (signed) |
| `v_beam_summary` | warp/weft actual vs planned, variance %, grey produced, wastage, m/kg |
| `v_loom_status` | which beam/quality is on each of the 68 looms, meters so far |
| `v_grey_stock` | grey m/kg per fabric quality per factory |
| `v_grey_stock_by_quality` | grey m/kg per fabric quality, all factories |
| `v_grey_ledger` | every grey movement (signed) |

**RPCs:** `load_beam(beam_id, loom_id)`, `finish_beam(beam_id)`, `record_takeoff(loom_id, meters, kgs, …, p_finish_beam)`.

**Errors the UI should handle** (custom SQLSTATE; `detail` is JSON):

| Code | Meaning | Example |
|---|---|---|
| `WV001` | Yarn lot would go negative | `Not enough yarn in lot A-101: 50.000 kg available, 100.000 kg requested` |
| `WV002` | Loom busy / unusable | `Loom L76-05 already has beam B-001 running. Finish or unload it first.` |
| `WV003` | Grey stock would go negative | `Not enough grey stock of Mono White at L-76: …` |
| `WV004` | Invalid beam/loom state | `Loom L76-33 has no beam running` |
| `WV005` | No access to that factory | |

## Reports

| Report | What it shows |
|---|---|
| Yarn stock by quality | Opening, inward, warp, weft, adjustments, closing kg per yarn quality |
| Yarn stock ledger by lot | The same per lot |
| Specification and quality summary | Per specification: production, wastage, rolls, finished stock, yarn issued and recorded, KG wastage — with a totals row per parent quality (or parents only) |
| Daily production | Per day by all looms (every loom listed for a single day), or by quality, specification or beam |
| Shift-wise production | Day / night / no-shift metres and entries per loom, with shift totals |
| Production register | Every production entry with date, actual time, counter reading, previous reading and metres source: total / wasted / net metres, wastage %, rolls, GSM, width, estimated and weighed kg, warp / weft / total yarn kg, waste kg (actual or estimated) |
| Loom-wise production | The same totals per loom and fabric quality, daily or monthly, per factory |
| Beam register | Beam → loom → yarn issued → production metres and wastage → weights where recorded |
| Roll tracking | Every roll: roll no, date, loom, beam, quality, metres |
| Grey stock summary | Opening, produced, dispatched, adjusted, closing (m and kg) per fabric quality and factory |
| Variance report | Planned vs actual warp and weft kg per beam; rows over the threshold in red |

"Opening" is everything before the *From* date; "closing" is everything up to the *To* date. Production, loom, beam, roll and variance reports also filter by loom, fabric quality and beam number. Weights that were not recorded show as blank, never 0, and estimated and actual kg are separate columns. Excel files contain real numbers and dates (formatted kg 0.000, m 0.00, dd-mm-yyyy) with a totals row; PDFs are A4 landscape. Factory staff only get their own factory.

## Opening stock import

1. **More → Import opening stock → Download template.** The template's dropdowns list your current yarn/fabric qualities, factories and suppliers (`templates/` has copies with the sample masters).
2. Fill one row per lot (yarn) or per fabric quality per factory (grey). Required columns are yellow. Dates DD-MM-YYYY (or Excel dates); blank date = today.
3. **Check file:** every problem is listed with its Excel row number (unknown quality, lot already exists, repeated lot, bad number or date, another factory…). Nothing is saved.
4. **Import N rows:** the file is checked again on the server and inserted in a single statement — all rows or none.

Yarn rows become yarn lots marked *opening*; grey rows become opening grey stock (adjustments marked *opening*) that can be dispatched. Owner and supervisors only.

## Setup

### Supabase project

1. Create a Supabase project (region: Mumbai `ap-south-1`).
2. Install the Supabase CLI, then from this repo:
   ```bash
   supabase init        # creates supabase/config.toml (keep the existing migrations/)
   supabase link --project-ref <your-project-ref>
   supabase db push     # applies supabase/migrations
   ```
3. Optional sample masters: run `supabase/seed.sql` in the SQL editor (production should enter its own qualities).
4. **First user:** the first person to sign up becomes the active **owner**. Everyone after that is created as an inactive `data_entry` user until the owner activates them and sets their role/factory.

Local development with Docker: `supabase start` then `supabase db reset` (applies migrations + seed).

### Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API keys (publishable key; the legacy anon key also works, or set `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `DATABASE_URL` | tests only; defaults to `postgres://postgres:postgres@127.0.0.1:5432/postgres` |

### Run the app

```bash
npm install
```
```bash
npm run dev
```

**Without a Supabase project** you can click through the app against the local test stack (needs local Postgres):

```bash
npm run dev:stack
```

Then in another terminal, using the key it prints:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<printed key> npm run dev
```

Sign in as `owner@test.local`, `sup76@test.local` or `entry76@test.local`, password `password123`.

## Tests

The suite runs against a real Postgres 15+ (a small shim in `tests/db/supabase-shim.sql` stands in for Supabase's `auth` schema and roles). It builds a template database from all migrations + seed, and every test file gets its own fresh clone.

```bash
npm install
```
```bash
npm run db:test:start   # starts local Postgres (Debian/Ubuntu); or set DATABASE_URL
```
```bash
npm test             # database, unit and data-layer tests (Vitest)
```
```bash
npm run test:e2e     # builds the app and drives it in a phone-sized Chromium (Playwright)
```

**§8 acceptance is automated three times:** at database level (`tests/db/acceptance.test.ts`), through the app's own data functions with RLS (`tests/app/phase5.test.ts`, all nine steps including dispatch), and in the browser across `tests/e2e/phase3.spec.ts` (steps 5–9) and `phase5.spec.ts` (dispatch).

The data-layer and browser tests run against `tests/stack/fake-supabase.ts`, a small stand-in for Supabase's gateway: real JWT sign-in, and the subset of PostgREST the app uses, executed as the signed-in user's role so RLS and triggers apply exactly as in production. It also serves a minimal Realtime websocket fed by `tests/db/realtime-shim.sql` (pg_notify triggers, test-only). It is not a full PostgREST or Realtime; keep app queries to views and simple filters (no embedded joins).

Database tests cover: the full §8 acceptance test (run as an authenticated owner with RLS on), seed counts, planning formulas and variance flags, audit trail, negative-stock blocking (including a concurrent-write race), one-beam-per-loom, loom status rules, grey stock checks, and role/factory permissions.

## Deploy

1. `supabase db push` (applies all migrations, 0001–0013).
2. Import the GitHub repo in Vercel, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, deploy.
3. Realtime: migration 0004 adds the stock tables to the `supabase_realtime` publication. Check in Supabase → Database → Publications that `supabase_realtime` lists `looms`, `beams`, `yarn_lots`, `yarn_consumption`, `grey_fabric_production`, `grey_fabric_dispatch`, `stock_adjustments`.
4. In Supabase → Authentication → URL configuration, set the Site URL to the Vercel URL. If "Confirm email" is on, new users confirm by email before signing in.

# Weaving Inventory — Yarn → Beam → Loom → Grey Fabric

A live, shared inventory system for a weaving unit in Surat with two factories (L-76: 36 looms, L-75: 32 looms). It tracks yarn lots from inward, through warp/weft consumption on beams, beams on looms, and grey fabric take-off, dispatch and stock.

**Stack:** Next.js (App Router, TypeScript) + Supabase (Postgres, Auth, Realtime) + Tailwind, deployable on Vercel.

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema, seed, stock views, DB-enforced rules, RLS | ✅ done |
| 2 | Sign-in, yarn inward, beam creation, warp/weft consumption, masters | ✅ done |
| 3 | Loom loading, fabric take-off, grey stock, loom grid | ✅ done |
| 4 | Live dashboard, realtime updates | ⏳ next |
| 5 | Dispatch, reports, Excel/PDF export, Excel import, role management UI | — |

## Screens

| Path | What it does |
|---|---|
| `/login`, `/signup`, `/pending` | Email + password sign-in; new accounts wait for the owner to activate them |
| `/` | Home: yarn stock total, beams ready / running, low-stock warning, quick actions |
| `/yarn` | Lots with live balance; stock-by-quality cards (tap to filter), factory toggle, search, "show used-up lots" |
| `/yarn/new` | Yarn inward: lot no, quality, kg, factory, supplier, challan, bags/cones, rate. "Save + new" for several lots |
| `/yarn/[id]` | One lot: received / warp / weft / balance and every movement with a running balance |
| `/beams` | Beams with status filter, search, warp/weft kg (red when over the variance limit) |
| `/beams/new` | New beam with a live planned warp/weft preview |
| `/beams/[id]` | Planned vs actual, load on loom / finish, yield (grey m & kg, wastage kg & %, m/kg), take-offs, add warp/weft lines lot by lot (live available kg) |
| `/masters/...` | Yarn qualities, fabric qualities, suppliers (owner + supervisor add/edit) |
| `/looms` | All 68 looms as tiles by factory (green = running, with beam and meters so far); factory toggle |
| `/looms/load` | Load on loom: pick a prepared beam and a free loom (beam's factory listed first) |
| `/looms/[id]` | One loom: current beam, take-off form, "Mark beam finished", "Unload" for supervisors (only before any fabric), loom history; load form when idle |
| `/takeoff` | Fabric take-off: pick a running loom (its beam fills in), meters + kg (live m/kg), shift, roll no, "last fabric — finish the beam" |
| `/grey` | Grey stock (m and kg) by fabric quality with the factory split; factory toggle |

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
  seed.sql                    sample yarn/fabric qualities + supplier (dev/test)
tests/db/                     database tests against real Postgres (incl. §8)
tests/unit/                   formatting, validation, planning, error messages
tests/app/                    data layer via supabase-js → fake gateway → Postgres + RLS
tests/e2e/                    Playwright, phone-sized browser, the real Next.js app
tests/stack/                  fake Supabase gateway (auth + PostgREST subset) for tests
scripts/start-local-postgres.sh
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

The data-layer and browser tests run against `tests/stack/fake-supabase.ts`, a small stand-in for Supabase's gateway: real JWT sign-in, and the subset of PostgREST the app uses, executed as the signed-in user's role so RLS and triggers apply exactly as in production. It is not a full PostgREST; keep app queries to views and simple filters (no embedded joins).

Database tests cover: the full §8 acceptance test (run as an authenticated owner with RLS on), seed counts, planning formulas and variance flags, audit trail, negative-stock blocking (including a concurrent-write race), one-beam-per-loom, loom status rules, grey stock checks, and role/factory permissions.

## Deploy

1. `supabase db push` (applies new migrations, e.g. 0006).
2. Import the GitHub repo in Vercel, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, deploy.
3. In Supabase → Authentication → URL configuration, set the Site URL to the Vercel URL. If "Confirm email" is on, new users confirm by email before signing in.

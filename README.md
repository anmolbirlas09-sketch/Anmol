# Weaving Inventory — Yarn → Beam → Loom → Grey Fabric

A live, shared inventory system for a weaving unit in Surat with two factories (L-76: 36 looms, L-75: 32 looms). It tracks yarn lots from inward, through warp/weft consumption on beams, beams on looms, and grey fabric take-off, dispatch and stock.

**Stack:** Next.js (App Router, TypeScript) + Supabase (Postgres, Auth, Realtime) + Tailwind, deployable on Vercel.

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema, seed, stock views, DB-enforced rules, RLS | ✅ done |
| 2 | Yarn inward, beam creation, consumption screens | ⏳ next |
| 3 | Loom loading, fabric take-off, grey stock screens | — |
| 4 | Dashboard, loom grid, realtime | — |
| 5 | Dispatch, reports, Excel/PDF export, Excel import, role management UI | — |

## Repository layout

```
supabase/
  migrations/
    …0001_core_schema.sql     tables, enums, created_*/updated_* stamps, audit_log
    …0002_integrity.sql       stock checks, one-beam-per-loom, state rules, RPCs
    …0003_views.sql           ledgers, balances, planned vs actual, loom status
    …0004_rls.sql             roles, row-level security, grants, realtime
    …0005_reference_data.sql  2 factories, 68 looms, default settings (all envs)
  seed.sql                    sample yarn/fabric qualities + supplier (dev/test)
tests/db/                     Vitest suite against a real Postgres (incl. §8)
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

Added with the Next.js app in phase 2:

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `DATABASE_URL` | tests only; defaults to `postgres://postgres:postgres@127.0.0.1:5432/postgres` |

## Tests

The suite runs against a real Postgres 15+ (a small shim in `tests/db/supabase-shim.sql` stands in for Supabase's `auth` schema and roles). It builds a template database from all migrations + seed, and every test file gets its own fresh clone.

```bash
npm install
```
```bash
npm run db:test:start   # starts local Postgres (Debian/Ubuntu); or set DATABASE_URL
```
```bash
npm test
```

Covered: the full §8 acceptance test (run as an authenticated owner with RLS on), seed counts, planning formulas and variance flags, audit trail, negative-stock blocking (including a concurrent-write race), one-beam-per-loom, loom status rules, grey stock checks, and role/factory permissions.

## Deploy

Phase 2 onward: push to GitHub, import the repo in Vercel, set the two `NEXT_PUBLIC_SUPABASE_*` variables, deploy. Database changes ship with `supabase db push`.

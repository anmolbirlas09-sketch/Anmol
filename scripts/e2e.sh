#!/usr/bin/env bash
# Builds the app against the fake Supabase gateway and runs the Playwright suite.
set -euo pipefail
cd "$(dirname "$0")/.."
export E2E_ANON_KEY="$(node --input-type=module -e "import { fakeAnonKey } from './tests/stack/fake-supabase.ts'; console.log(await fakeAnonKey())")"
[ -n "${SKIP_BUILD:-}" ] || NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$E2E_ANON_KEY" npx next build
npx playwright test "$@"

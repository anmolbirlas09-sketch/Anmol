import type { SupabaseClient } from '@supabase/supabase-js';

/** Any Supabase client (server, browser or test) acting as some user. Untyped schema. */
export type Db = SupabaseClient;

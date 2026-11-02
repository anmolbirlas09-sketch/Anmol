import type { SupabaseClient } from '@supabase/supabase-js';

/** Any Supabase client (server, browser or test) acting as some user. Untyped schema. */
export type Db = SupabaseClient;

/**
 * Data functions accept a missing specification: the database fills it in when
 * the parent quality has exactly one active specification, and refuses otherwise.
 */
export type SpecOptional<T extends object> = Omit<T, 'fabric_specification_id'> & { fabric_specification_id?: string | null };

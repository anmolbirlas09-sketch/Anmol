import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

// Numeric columns come back as strings; keep it that way and compare with num().
export const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
export const TEMPLATE_DB = 'weaving_test_template';

const root = join(import.meta.dirname, '..', '..');

/** Shim + every migration (in order) + realtime shim + seed, as one list of SQL files. */
export function schemaFiles(): string[] {
  const migrations = readdirSync(join(root, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(root, 'supabase', 'migrations', f));
  return [
    join(root, 'tests', 'db', 'supabase-shim.sql'),
    ...migrations,
    join(root, 'tests', 'db', 'realtime-shim.sql'),
    join(root, 'supabase', 'seed.sql'),
  ];
}

export function readSql(file: string): string {
  return readFileSync(file, 'utf8');
}

function urlFor(db: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function admin<T>(fn: (c: pg.Client) => Promise<T>, db = new URL(ADMIN_URL).pathname.slice(1)): Promise<T> {
  const c = new pg.Client({ connectionString: urlFor(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export const num = (v: unknown): number => Number(v);

export interface TestDb {
  name: string;
  /** Superuser connection (bypasses RLS) — the "service" context. */
  sql: pg.Client;
  /** Connection that behaves like a PostgREST request from this auth user. */
  as(userId: string): Promise<pg.Client>;
  /** Create an auth user + activate their app_users profile with this role. */
  createUser(opts: { email: string; role: 'owner' | 'supervisor' | 'data_entry'; factoryCode?: string | null; name?: string; password?: string }): Promise<string>;
  url: string;
  id(table: string, column: string, value: string): Promise<string>;
  close(): Promise<void>;
}

/** A fresh database cloned from the migrated + seeded template. */
export async function freshDb(): Promise<TestDb> {
  const name = `weaving_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  await admin((c) => c.query(`create database ${name} template ${TEMPLATE_DB}`));
  const sql = new pg.Client({ connectionString: urlFor(name) });
  await sql.connect();
  const clients: pg.Client[] = [];

  const db: TestDb = {
    name,
    sql,
    async as(userId) {
      const c = new pg.Client({ connectionString: urlFor(name) });
      await c.connect();
      await c.query(`set role authenticated`);
      await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
      clients.push(c);
      return c;
    },
    url: urlFor(name),
    async createUser({ email, role, factoryCode = null, name: userName, password = 'password123' }) {
      const { rows } = await sql.query(
        `insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id`,
        [email, password, { name: userName ?? email.split('@')[0] }],
      );
      const id = rows[0].id as string;
      await sql.query(
        `update public.app_users
            set role = $2, active = true,
                factory_id = (select id from public.factories where code = $3)
          where id = $1`,
        [id, role, factoryCode],
      );
      return id;
    },
    async id(table, column, value) {
      const { rows } = await sql.query(`select id from public.${table} where ${column} = $1`, [value]);
      if (rows.length !== 1) throw new Error(`${table}.${column} = ${value}: ${rows.length} rows`);
      return rows[0].id;
    },
    async close() {
      await Promise.all(clients.map((c) => c.end()));
      await sql.end();
      await admin((c) => c.query(`drop database if exists ${name} with (force)`));
    },
  };
  return db;
}

/** Run fn and return the Postgres error it throws (fails if it doesn't throw). */
export async function pgError(fn: () => Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await fn();
  } catch (e) {
    return e as pg.DatabaseError;
  }
  throw new Error('expected a database error, but the statement succeeded');
}

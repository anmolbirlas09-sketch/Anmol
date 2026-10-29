// Starts a throwaway database + fake Supabase gateway for the e2e tests and
// local UI demos:  node tests/stack/serve.ts   (Ctrl-C to stop)
//
// Users (password "password123"):
//   owner@test.local     owner, all factories
//   sup76@test.local     supervisor, L-76
//   entry76@test.local   data entry, L-76
import { ADMIN_URL, admin, readSql, schemaFiles } from '../db/db.ts';
import { startFakeSupabase } from './fake-supabase.ts';

const DB = process.env.E2E_DB ?? 'weaving_e2e';
const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54321);

await admin(async (c) => {
  await c.query(`drop database if exists ${DB} with (force)`);
  await c.query(`create database ${DB}`);
});
await admin(async (c) => {
  for (const f of schemaFiles()) await c.query(readSql(f));
  const users: [string, string, string, string | null][] = [
    ['owner@test.local', 'Owner Bhai', 'owner', null],
    ['sup76@test.local', 'Supervisor 76', 'supervisor', 'L-76'],
    ['entry76@test.local', 'Ramesh', 'data_entry', 'L-76'],
  ];
  for (const [email, name, role, factory] of users) {
    const { rows } = await c.query(
      `insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, 'password123', $2) returning id`,
      [email, { name }],
    );
    await c.query(
      `update app_users set role = $2, active = true, factory_id = (select id from factories where code = $3) where id = $1`,
      [rows[0].id, role, factory],
    );
  }
}, DB);

const url = new URL(ADMIN_URL);
url.pathname = `/${DB}`;
const gw = await startFakeSupabase({ databaseUrl: url.toString(), port: PORT });
console.log(`fake supabase ready on ${gw.url}`);
console.log(`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${gw.anonKey}`);

const stop = async () => {
  await gw.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

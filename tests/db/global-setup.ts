import { ADMIN_URL, TEMPLATE_DB, admin, readSql, schemaFiles } from './db';

// Build one template database (shim + migrations + seed). Each test file
// then clones it, so every file starts from the same clean, seeded state.
export async function setup() {
  try {
    await admin((c) => c.query('select 1'));
  } catch (e) {
    throw new Error(
      `Cannot reach Postgres at ${ADMIN_URL}. Run \`npm run db:test:start\` or set DATABASE_URL.\n${(e as Error).message}`,
    );
  }
  await admin(async (c) => {
    await c.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
    await c.query(`create database ${TEMPLATE_DB}`);
  });
  await admin(async (c) => {
    for (const file of schemaFiles()) {
      try {
        await c.query(readSql(file));
      } catch (e) {
        throw new Error(`Failed applying ${file}: ${(e as Error).message}`);
      }
    }
  }, TEMPLATE_DB);
}

export async function teardown() {
  await admin((c) => c.query(`drop database if exists ${TEMPLATE_DB} with (force)`));
}

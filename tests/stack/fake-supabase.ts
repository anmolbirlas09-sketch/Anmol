// A small stand-in for the Supabase API gateway, for tests only.
//
//   /auth/v1/*  — password sign-in/up, refresh, user, logout (JWTs signed HS256)
//   /rest/v1/*  — the subset of PostgREST that this app's queries use:
//                 select/filters/or/order/limit, count, single, insert, update,
//                 delete, rpc. Each request runs in its own transaction as the
//                 JWT's role with request.jwt.claims set, exactly like PostgREST,
//                 so row-level security and triggers behave as in production.
//
//   /realtime/v1/websocket — Phoenix-protocol postgres_changes, fed by
//                 pg_notify from tests/db/realtime-shim.sql (no RLS filtering:
//                 the app only uses events as a "something changed" signal).
//
// It is NOT a general PostgREST: embedded resources, nested logic trees and
// upserts are not implemented. Keep app queries to views + simple filters.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import pg from 'pg';
import { WebSocketServer, type WebSocket } from 'ws';

export interface FakeSupabase {
  url: string;
  anonKey: string;
  pool: pg.Pool;
  close(): Promise<void>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string) => {
  if (!IDENT.test(s)) throw new HttpError(400, { code: 'PGRST100', message: `bad identifier: ${s}` });
  return `"${s}"`;
};

class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.message));
    this.status = status;
    this.body = body;
  }
}

// Same HTTP status mapping as PostgREST for the codes we care about.
function statusFor(code: string | undefined, role: string): number {
  if (!code) return 500;
  if (code === '42501') return role === 'anon' ? 401 : 403;
  if (code === '23505' || code === '23503') return 409;
  if (code === '42P01' || code === '42883') return 404;
  if (code.startsWith('22') || code.startsWith('23') || code === 'P0001' || /^[A-Z]{2}\d{3}$/.test(code)) return 400;
  return 400;
}

interface Claims {
  sub?: string;
  role: string;
  email?: string;
  aud?: string;
  exp?: number;
}

const DEFAULT_SECRET = 'fake-supabase-test-secret-at-least-32-chars';

/** Deterministic anon key for a secret, so the Next.js app can be configured before the gateway starts. */
export function fakeAnonKey(jwtSecret = DEFAULT_SECRET): Promise<string> {
  return new SignJWT({ role: 'anon', iss: 'fake-supabase' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(1767225600)
    .setExpirationTime(4102444800)
    .sign(new TextEncoder().encode(jwtSecret));
}

export async function startFakeSupabase(opts: { databaseUrl: string; port?: number; jwtSecret?: string }): Promise<FakeSupabase> {
  const secret = new TextEncoder().encode(opts.jwtSecret ?? DEFAULT_SECRET);
  // numeric/bigint → JSON number and date → 'YYYY-MM-DD', as PostgREST returns them
  const types = {
    getTypeParser: ((oid: number, format?: string) =>
      oid === 1700 || oid === 20 ? (v: string) => Number(v) : oid === 1082 ? (v: string) => v : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser,
  };
  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10, types });
  const refreshTokens = new Map<string, string>(); // token → user id

  const sign = (claims: Record<string, unknown>, ttl = 3600) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setExpirationTime(`${ttl}s`).sign(secret);

  const anonKey = await fakeAnonKey(opts.jwtSecret);

  async function verify(token: string | undefined): Promise<Claims | null> {
    if (!token) return null;
    try {
      return (await jwtVerify(token, secret)).payload as unknown as Claims;
    } catch {
      return null;
    }
  }

  async function userJson(id: string) {
    const { rows } = await pool.query(`select id, email, raw_user_meta_data, created_at from auth.users where id = $1`, [id]);
    if (!rows[0]) return null;
    const u = rows[0];
    return {
      id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
      email_confirmed_at: u.created_at, confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data ?? {},
      identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
    };
  }

  async function session(id: string) {
    const user = await userJson(id);
    const expiresIn = 3600;
    const access_token = await sign({ sub: id, role: 'authenticated', aud: 'authenticated', email: user?.email, session_id: randomUUID() }, expiresIn);
    const refresh_token = randomUUID();
    refreshTokens.set(refresh_token, id);
    return { access_token, token_type: 'bearer', expires_in: expiresIn, expires_at: Math.floor(Date.now() / 1000) + expiresIn, refresh_token, user };
  }

  // ---------------------------------------------------------------- auth
  async function handleAuth(req: http.IncomingMessage, url: URL, body: Record<string, unknown>) {
    const path = url.pathname.replace(/^\/auth\/v1/, '');
    const authErr = (status: number, code: string, message: string) => new HttpError(status, { code, error_code: code, msg: message, message });

    if (path === '/token' && url.searchParams.get('grant_type') === 'password') {
      const { rows } = await pool.query(`select id from auth.users where lower(email) = lower($1) and encrypted_password = $2`, [body.email, body.password]);
      if (!rows[0]) throw authErr(400, 'invalid_credentials', 'Invalid login credentials');
      return session(rows[0].id);
    }
    if (path === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const id = refreshTokens.get(String(body.refresh_token));
      if (!id) throw authErr(400, 'refresh_token_not_found', 'Invalid Refresh Token');
      refreshTokens.delete(String(body.refresh_token));
      return session(id);
    }
    if (path === '/signup') {
      const exists = await pool.query(`select 1 from auth.users where lower(email) = lower($1)`, [body.email]);
      if (exists.rowCount) throw authErr(422, 'user_already_exists', 'User already registered');
      const { rows } = await pool.query(
        `insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id`,
        [body.email, body.password, body.data ?? {}],
      );
      return session(rows[0].id);
    }
    if (path === '/user') {
      const claims = await verify(bearer(req));
      if (!claims?.sub) throw authErr(401, 'bad_jwt', 'invalid JWT');
      const user = await userJson(claims.sub);
      if (!user) throw authErr(403, 'user_not_found', 'User not found');
      return user;
    }
    if (path === '/logout') return null;
    if (path === '/health') return { name: 'fake-supabase', version: 'test' };
    throw authErr(404, 'not_found', `fake auth: ${req.method} ${path} not implemented`);
  }

  const bearer = (req: http.IncomingMessage) => req.headers.authorization?.replace(/^Bearer\s+/i, '');

  // ---------------------------------------------------------------- rest
  function parseValue(v: string) {
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    return v;
  }

  function condition(col: string, expr: string, params: unknown[]): string {
    const c = ident(col);
    let negate = false;
    if (expr.startsWith('not.')) {
      negate = true;
      expr = expr.slice(4);
    }
    const dot = expr.indexOf('.');
    const op = expr.slice(0, dot);
    const raw = expr.slice(dot + 1);
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    let sql: string;
    switch (op) {
      case 'eq': sql = `${c} = ${p(parseValue(raw))}`; break;
      case 'neq': sql = `${c} <> ${p(parseValue(raw))}`; break;
      case 'gt': sql = `${c} > ${p(raw)}`; break;
      case 'gte': sql = `${c} >= ${p(raw)}`; break;
      case 'lt': sql = `${c} < ${p(raw)}`; break;
      case 'lte': sql = `${c} <= ${p(raw)}`; break;
      case 'like': sql = `${c}::text like ${p(raw.replace(/\*/g, '%'))}`; break;
      case 'ilike': sql = `${c}::text ilike ${p(raw.replace(/\*/g, '%'))}`; break;
      case 'is': {
        const v = raw.toLowerCase();
        if (!['null', 'true', 'false', 'unknown'].includes(v)) throw new HttpError(400, { code: 'PGRST100', message: `bad is value ${raw}` });
        sql = `${c} is ${v}`;
        break;
      }
      case 'in': {
        const items = raw.replace(/^\(|\)$/g, '').split(',').filter(Boolean).map(parseValue);
        sql = items.length ? `${c} in (${items.map(p).join(', ')})` : 'false';
        break;
      }
      default:
        throw new HttpError(400, { code: 'PGRST100', message: `fake postgrest: operator ${op} not implemented` });
    }
    return negate ? `not (${sql})` : sql;
  }

  function splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0, cur = '', quoted = false;
    for (const ch of s) {
      if (ch === '"') quoted = !quoted;
      if (!quoted && ch === '(') depth++;
      if (!quoted && ch === ')') depth--;
      if (!quoted && depth === 0 && ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  function whereClause(sp: URLSearchParams, params: unknown[]): string {
    const conds: string[] = [];
    for (const [key, value] of sp.entries()) {
      if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
      if (key === 'or' || key === 'and') {
        const parts = splitTopLevel(value.replace(/^\(|\)$/g, '')).map((part) => {
          const d = part.indexOf('.');
          return condition(part.slice(0, d), part.slice(d + 1), params);
        });
        conds.push(`(${parts.join(key === 'or' ? ' or ' : ' and ')})`);
      } else conds.push(condition(key, value, params));
    }
    return conds.length ? ` where ${conds.join(' and ')}` : '';
  }

  function selectList(sp: URLSearchParams): string {
    const s = sp.get('select') ?? '*';
    if (s === '*') return '*';
    return s
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        if (c.includes('(')) throw new HttpError(400, { code: 'PGRST100', message: 'fake postgrest: embedding not implemented' });
        const [alias, col] = c.includes(':') ? c.split(':') : [null, c];
        return alias ? `${ident(col)} as ${ident(alias)}` : ident(col);
      })
      .join(', ');
  }

  function orderClause(sp: URLSearchParams): string {
    const o = sp.get('order');
    if (!o) return '';
    return ` order by ${o
      .split(',')
      .map((part) => {
        const [col, ...mods] = part.split('.');
        const dir = mods.includes('desc') ? 'desc' : 'asc';
        const nulls = mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '';
        return `${ident(col)} ${dir}${nulls}`;
      })
      .join(', ')}`;
  }

  async function handleRest(req: http.IncomingMessage, url: URL, body: unknown, res: http.ServerResponse) {
    const token = bearer(req) ?? (req.headers.apikey as string | undefined);
    const claims = await verify(token);
    if (!claims) throw new HttpError(401, { code: 'PGRST301', message: 'JWT invalid', details: null, hint: null });
    const role = claims.role;
    if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new HttpError(401, { code: 'PGRST301', message: 'bad role' });

    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    const sp = url.searchParams;
    const prefer = String(req.headers.prefer ?? '');
    const wantsObject = String(req.headers.accept ?? '').includes('application/vnd.pgrst.object+json');
    const returnRep = prefer.includes('return=representation');
    const method = req.method ?? 'GET';

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${ident(role)}`);
      await client.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
        JSON.stringify(claims), claims.sub ?? '',
      ]);

      let rows: Record<string, unknown>[] = [];
      let count: number | null = null;
      let isScalar = false;
      let scalar: unknown;

      if (path.startsWith('rpc/')) {
        const fn = path.slice(4);
        const args = (body ?? {}) as Record<string, unknown>;
        const params: unknown[] = [];
        const argSql = Object.entries(args).map(([k, v]) => {
          params.push(v);
          return `${ident(k)} => $${params.length}`;
        });
        const meta = await client.query(
          `select p.proretset, t.typtype from pg_proc p join pg_type t on t.oid = p.prorettype
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`,
          [fn],
        );
        if (!meta.rows[0]) throw Object.assign(new Error(`function ${fn} not found`), { code: '42883' });
        const { proretset, typtype } = meta.rows[0];
        if (typtype === 'c' || proretset) {
          rows = (await client.query(`select * from public.${ident(fn)}(${argSql.join(', ')})`, params)).rows;
          if (!proretset) {
            isScalar = true;
            scalar = rows[0] ?? null;
          }
        } else {
          isScalar = true;
          scalar = (await client.query(`select public.${ident(fn)}(${argSql.join(', ')}) as v`, params)).rows[0]?.v ?? null;
        }
      } else {
        const rel = `public.${ident(path)}`;
        const params: unknown[] = [];
        const where = whereClause(sp, params);
        const sel = selectList(sp);
        if (method === 'GET' || method === 'HEAD') {
          const limit = sp.get('limit') ? ` limit ${Number(sp.get('limit'))}` : '';
          const offset = sp.get('offset') ? ` offset ${Number(sp.get('offset'))}` : '';
          if (method === 'GET') rows = (await client.query(`select ${sel} from ${rel}${where}${orderClause(sp)}${limit}${offset}`, params)).rows;
          if (/count=(exact|planned|estimated)/.test(prefer)) {
            count = Number((await client.query(`select count(*) from ${rel}${where}`, params)).rows[0].count);
          }
        } else if (method === 'POST') {
          const list = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
          const cols = [...new Set(list.flatMap((r) => Object.keys(r)))];
          const values = list.map((r) => `(${cols.map((c) => {
            if (!(c in r)) return 'default';
            params.push(r[c]);
            return `$${params.length}`;
          }).join(', ')})`);
          const sql = cols.length
            ? `insert into ${rel} (${cols.map(ident).join(', ')}) values ${values.join(', ')} returning ${sel}`
            : `insert into ${rel} default values returning ${sel}`;
          rows = (await client.query(sql, params)).rows;
        } else if (method === 'PATCH') {
          const set = Object.entries(body as Record<string, unknown>).map(([k, v]) => {
            params.push(v);
            return `${ident(k)} = $${params.length}`;
          });
          rows = (await client.query(`update ${rel} set ${set.join(', ')}${where} returning ${sel}`, params)).rows;
        } else if (method === 'DELETE') {
          rows = (await client.query(`delete from ${rel}${where} returning ${sel}`, params)).rows;
        }
      }

      if (wantsObject && !isScalar && (method === 'GET' || returnRep) && rows.length !== 1) {
        throw new HttpError(406, {
          code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${rows.length} rows`, hint: null,
        });
      }
      await client.query('commit');

      const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
      if (count !== null) headers['content-range'] = `${rows.length ? `0-${rows.length - 1}` : '*'}/${count}`;
      const isWrite = ['POST', 'PATCH', 'DELETE'].includes(method) && !path.startsWith('rpc/');
      if (method === 'HEAD' || (isWrite && !returnRep)) {
        res.writeHead(method === 'POST' ? 201 : 204, headers).end();
        return;
      }
      const payload = isScalar ? scalar : wantsObject ? rows[0] : rows;
      res.writeHead(method === 'POST' && !path.startsWith('rpc/') ? 201 : 200, headers).end(JSON.stringify(payload));
    } catch (e) {
      await client.query('rollback').catch(() => {});
      if (e instanceof HttpError) throw e;
      const err = e as pg.DatabaseError;
      throw new HttpError(statusFor(err.code, role), {
        code: err.code ?? '', message: err.message, details: err.detail ?? null, hint: err.hint ?? null,
      });
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------- server
  const server = http.createServer(async (req, res) => {
    const cors = {
      'access-control-allow-origin': req.headers.origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version',
      'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'access-control-expose-headers': 'content-range',
    };
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : undefined;

      if (url.pathname.startsWith('/auth/v1/')) {
        const out = await handleAuth(req, url, (body ?? {}) as Record<string, unknown>);
        if (out === null) return void res.writeHead(204).end();
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      }
      if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, url, body, res);
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'not found' }));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const payload = e instanceof HttpError ? e.body : { message: (e as Error).message };
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    }
  });

  // ---------------------------------------------------------------- realtime
  interface Binding { id: number; event: string; schema?: string; table?: string; filter?: string }
  interface Sub { topic: string; joinRef: string | null; bindings: Binding[] }
  const subs = new Map<WebSocket, Sub[]>();
  let nextBindingId = 1;
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/realtime/v1/websocket')) return void socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      subs.set(ws, []);
      ws.on('message', (raw) => {
        let msg: [string | null, string | null, string, string, Record<string, unknown>];
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const [joinRef, ref, topic, event, payload] = msg;
        const reply = (response: Record<string, unknown> = {}) =>
          ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]));
        if (event === 'phx_join') {
          const config = (payload?.config ?? {}) as { postgres_changes?: Omit<Binding, 'id'>[] };
          const bindings = (config.postgres_changes ?? []).map((b) => ({ ...b, id: nextBindingId++ }));
          subs.get(ws)?.push({ topic, joinRef, bindings });
          reply({ postgres_changes: bindings });
        } else if (event === 'phx_leave') {
          subs.set(ws, (subs.get(ws) ?? []).filter((x) => x.topic !== topic));
          reply();
        } else {
          reply(); // heartbeat, access_token, …
        }
      });
      ws.on('close', () => subs.delete(ws));
    });
  });

  const listener = new pg.Client({ connectionString: opts.databaseUrl });
  await listener.connect();
  await listener.query('listen fake_realtime');
  listener.on('notification', (n) => {
    const change = JSON.parse(n.payload ?? '{}') as { table: string; type: string; id: string | null };
    for (const [ws, list] of subs) {
      for (const sub of list) {
        const ids = sub.bindings
          .filter((b) => (!b.table || b.table === '*' || b.table === change.table) && (b.event === '*' || b.event === change.type))
          .map((b) => b.id);
        if (!ids.length) continue;
        const rec = { id: change.id };
        ws.send(JSON.stringify([sub.joinRef, null, sub.topic, 'postgres_changes', {
          ids,
          data: {
            schema: 'public', table: change.table, commit_timestamp: new Date().toISOString(), type: change.type,
            columns: [], record: change.type === 'DELETE' ? {} : rec, old_record: change.type === 'INSERT' ? {} : rec, errors: null,
          },
        }]));
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}`,
    anonKey,
    pool,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await listener.end();
      await new Promise<void>((r) => server.close(() => r()));
      await pool.end();
    },
  };
}

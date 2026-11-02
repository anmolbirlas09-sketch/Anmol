import { fmtKg } from './format';
import { L } from './labels';

/** Shape of an error coming back from PostgREST / supabase-js. */
export interface DbError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

export class DataError extends Error {
  constructor(public readonly db: DbError) {
    super(db.message);
  }
}

/** What RLS amounts to when an update/delete silently matched no rows. */
export const notAllowed = () => new DataError({ code: '42501', message: 'not allowed' });

/** Throw a DataError if a supabase-js result failed; otherwise return its data. */
export function unwrap<T>(res: { data: T | null; error: DbError | null }): NonNullable<T> {
  if (res.error) throw new DataError(res.error);
  return res.data as NonNullable<T>;
}

function parseDetail(details?: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

// Unique indexes → what the user typed that clashed.
const DUPLICATE_WHAT: Record<string, string> = {
  yarn_lots_lot_no_key: 'lot no',
  beams_beam_no_key: 'beam no',
  looms_machine_no_key: 'machine no',
  yarn_qualities_name_key: 'yarn quality',
  fabric_qualities_name_key: 'fabric quality',
  suppliers_name_key: 'supplier',
  factories_code_key: 'factory code',
  fabric_specifications_combo_key: 'specification (same reed, ends per inch and yarns)',
};

/** Turn a database error into a sentence for the shop floor. */
export function friendlyError(e: unknown): string {
  const err: DbError | undefined = e instanceof DataError ? e.db : (e as DbError | undefined);
  if (!err || typeof err.message !== 'string') return L.errors.generic;

  switch (err.code) {
    case 'WV001': {
      const d = parseDetail(err.details);
      if (d && typeof d.lot_no === 'string') return L.errors.insufficientYarn(d.lot_no, fmtKg(d.available_kg as number));
      return err.message;
    }
    case 'WV002':
    case 'WV003':
    case 'WV004':
    case 'WV005':
      return err.message;
    case '23505': {
      const key = Object.keys(DUPLICATE_WHAT).find((k) => err.message.includes(k) || err.details?.includes(k));
      return L.errors.duplicate(key ? DUPLICATE_WHAT[key] : 'entry');
    }
    case '42501':
    case 'PGRST301':
      return L.errors.permission;
    case '23514':
    case '22P02':
    case '22003':
      return L.errors.generic;
    default:
      return L.errors.generic;
  }
}

export function isPermissionError(e: unknown): boolean {
  const err = e instanceof DataError ? e.db : (e as DbError | undefined);
  return err?.code === '42501';
}

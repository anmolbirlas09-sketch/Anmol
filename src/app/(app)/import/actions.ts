'use server';

import { revalidatePath } from 'next/cache';
import { canEdit, getCurrentUser } from '@/lib/auth';
import { importGreyRows, importMasters, importYarnRows } from '@/lib/data/imports';
import { friendlyError } from '@/lib/errors';
import { isImportKind, parseWorkbook, readWorkbook, type GreyImportRow, type ImportError, type YarnImportRow } from '@/lib/importer';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';

export interface ImportState {
  checked?: boolean;
  fileName?: string;
  rows?: (YarnImportRow | GreyImportRow)[];
  errors?: ImportError[];
  imported?: number;
  error?: string;
}

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Check the uploaded file; with commit=1 also import it. The file is parsed and
 * validated again on commit, so the browser never sends rows we did not check.
 */
export async function importAction(_: ImportState, form: FormData): Promise<ImportState> {
  const kind = String(form.get('kind') ?? '');
  const file = form.get('file');
  if (!isImportKind(kind)) return { error: L.errors.generic };
  const user = await getCurrentUser();
  if (!user?.active || !canEdit(user)) return { error: L.importer.who };
  if (!(file instanceof File) || file.size === 0) return { error: L.importer.badFile };
  if (file.size > MAX_BYTES) return { error: L.importer.badFile };

  const db = await createClient();
  let parsed;
  try {
    const wb = await readWorkbook(await file.arrayBuffer());
    parsed = parseWorkbook(wb, kind, await importMasters(db, user.factory_id));
  } catch {
    return { error: L.importer.badFile, fileName: file.name };
  }
  const base = { checked: true, fileName: file.name, rows: parsed.rows, errors: parsed.errors };
  if (!parsed.rows.length && !parsed.errors.length) return { ...base, error: L.importer.noRows };
  if (form.get('commit') !== '1' || parsed.errors.length) return base;

  try {
    const n = parsed.kind === 'yarn' ? await importYarnRows(db, parsed.rows) : await importGreyRows(db, parsed.rows);
    for (const p of ['/', '/yarn', '/grey']) revalidatePath(p);
    return { imported: n, fileName: file.name };
  } catch (e) {
    return { ...base, error: friendlyError(e) };
  }
}

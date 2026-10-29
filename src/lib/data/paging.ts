import { unwrap, type DbError } from '../errors';

/**
 * Read every row of a query in pages. Supabase caps each API response at its
 * "max rows" setting (1000 by default), so long lists for reports and exports
 * are fetched page by page. `page(from, to)` must apply `.range(from, to)` to a
 * query with a stable order.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const rows = unwrap(await page(from, from + pageSize - 1));
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

import type { Factory } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid from the URL, or undefined for anything else (so junk never reaches a query). */
export const uuidParam = (v: string | string[] | undefined) => (typeof v === 'string' && UUID.test(v) ? v : undefined);

/**
 * The factory toggle from ?factory=: an id of a known factory, 'all' (= undefined),
 * or, when absent/unknown, the fallback (e.g. the user's own factory).
 */
export function factoryParam(v: string | string[] | undefined, factories: Factory[], fallback?: string | null): string | undefined {
  if (v === 'all') return undefined;
  if (typeof v === 'string' && factories.some((f) => f.id === v)) return v;
  return fallback ?? undefined;
}

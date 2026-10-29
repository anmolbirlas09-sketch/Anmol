import { todayIST } from '../format';
import type { Factory } from '../types';
import type { ReportParams } from './model';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Report parameters from the URL; defaults to this month so far, user's factory. */
export function reportParams(
  sp: Record<string, string | string[] | undefined>,
  factories: Factory[],
  userFactoryId: string | null,
): ReportParams {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const today = todayIST();
  let from = one('from') && ISO.test(one('from')!) ? one('from')! : `${today.slice(0, 8)}01`;
  let to = one('to') && ISO.test(one('to')!) ? one('to')! : today;
  if (from > to) [from, to] = [to, from];
  const requested = one('factory');
  // Factory-scoped users always get their own factory.
  const factoryId = userFactoryId ?? (requested && factories.some((f) => f.id === requested) ? requested : undefined);
  return {
    from,
    to,
    factoryId,
    factoryCode: factories.find((f) => f.id === factoryId)?.code,
    period: one('period') === 'month' ? 'month' : 'day',
  };
}

export function reportQuery(p: ReportParams): string {
  const q = new URLSearchParams({ from: p.from, to: p.to, period: p.period });
  if (p.factoryId) q.set('factory', p.factoryId);
  return q.toString();
}

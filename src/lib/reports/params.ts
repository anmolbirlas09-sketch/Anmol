import { todayIST } from '../format';
import { uuidParam } from '../params';
import type { Factory } from '../types';
import type { ReportParams } from './model';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Report parameters from the URL; defaults to this month so far, user's factory. */
export function reportParams(
  sp: Record<string, string | string[] | undefined>,
  factories: Factory[],
  userFactoryId: string | null,
  lists: { looms?: { id: string; machine_no: string }[]; qualities?: { id: string; name: string }[] } = {},
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
    loomId: uuidParam(sp.loom),
    loomNo: lists.looms?.find((l) => l.id === uuidParam(sp.loom))?.machine_no,
    fabricQualityId: uuidParam(sp.quality),
    fabricQualityName: lists.qualities?.find((q) => q.id === uuidParam(sp.quality))?.name,
    beamNo: one('beam')?.trim().toUpperCase().slice(0, 50) || undefined,
  };
}

export function reportQuery(p: ReportParams): string {
  const q = new URLSearchParams({ from: p.from, to: p.to, period: p.period });
  if (p.factoryId) q.set('factory', p.factoryId);
  if (p.loomId) q.set('loom', p.loomId);
  if (p.fabricQualityId) q.set('quality', p.fabricQualityId);
  if (p.beamNo) q.set('beam', p.beamNo);
  return q.toString();
}

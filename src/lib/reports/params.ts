import { todayIST } from '../format';
import { uuidParam } from '../params';
import type { Factory } from '../types';
import { DAILY_GROUPS, type DailyGroup, type ReportParams } from './model';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Report parameters from the URL; defaults to this month so far, user's factory. */
export function reportParams(
  sp: Record<string, string | string[] | undefined>,
  factories: Factory[],
  userFactoryId: string | null,
  lists: { looms?: { id: string; machine_no: string }[]; qualities?: { id: string; name: string }[]; specs?: { id: string; spec_code: string }[] } = {},
  /** Default to today only (daily report) instead of this month so far. */
  defaultToday = false,
): ReportParams {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const today = todayIST();
  let from = one('from') && ISO.test(one('from')!) ? one('from')! : defaultToday ? today : `${today.slice(0, 8)}01`;
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
    fabricSpecificationId: uuidParam(sp.spec),
    specCode: lists.specs?.find((s) => s.id === uuidParam(sp.spec))?.spec_code,
    beamNo: one('beam')?.trim().toUpperCase().slice(0, 50) || undefined,
    showSpecs: one('specs') !== '0',
    timeFrom: HHMM.test(one('tfrom') ?? '') ? one('tfrom') : undefined,
    timeTo: HHMM.test(one('tto') ?? '') ? one('tto') : undefined,
    shift: one('shift') === 'day' || one('shift') === 'night' ? (one('shift') as 'day' | 'night') : undefined,
    group: DAILY_GROUPS.find((g) => g === one('group')) as DailyGroup | undefined,
  };
}

export function reportQuery(p: ReportParams): string {
  const q = new URLSearchParams({ from: p.from, to: p.to, period: p.period });
  if (p.factoryId) q.set('factory', p.factoryId);
  if (p.loomId) q.set('loom', p.loomId);
  if (p.fabricQualityId) q.set('quality', p.fabricQualityId);
  if (p.fabricSpecificationId) q.set('spec', p.fabricSpecificationId);
  if (p.beamNo) q.set('beam', p.beamNo);
  if (p.showSpecs === false) q.set('specs', '0');
  if (p.timeFrom) q.set('tfrom', p.timeFrom);
  if (p.timeTo) q.set('tto', p.timeTo);
  if (p.shift) q.set('shift', p.shift);
  if (p.group) q.set('group', p.group);
  return q.toString();
}

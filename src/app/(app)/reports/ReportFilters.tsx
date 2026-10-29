import { inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { ReportParams } from '@/lib/reports/model';
import type { Factory } from '@/lib/types';

/** Plain GET form: the filters live in the URL, so reports can be bookmarked and shared. */
export function ReportFilters({ action, p, factories, lockedFactory, showPeriod }: { action: string; p: ReportParams; factories: Factory[]; lockedFactory: boolean; showPeriod?: boolean }) {
  return (
    <form action={action} className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-5">
      <label className="text-sm font-semibold">
        {L.reports.from}
        <input type="date" name="from" defaultValue={p.from} className={`${inputClass} mt-1 font-normal`} />
      </label>
      <label className="text-sm font-semibold">
        {L.reports.to}
        <input type="date" name="to" defaultValue={p.to} className={`${inputClass} mt-1 font-normal`} />
      </label>
      <label className="text-sm font-semibold">
        {L.reports.factory}
        <select name="factory" defaultValue={p.factoryId ?? ''} disabled={lockedFactory} className={`${inputClass} mt-1 font-normal`}>
          <option value="">{L.app.allFactories}</option>
          {factories.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
        </select>
      </label>
      {showPeriod ? (
        <label className="text-sm font-semibold">
          {L.reports.period}
          <select name="period" defaultValue={p.period} className={`${inputClass} mt-1 font-normal`}>
            <option value="day">{L.reports.daily}</option>
            <option value="month">{L.reports.monthly}</option>
          </select>
        </label>
      ) : (
        <input type="hidden" name="period" value={p.period} />
      )}
      <button className={`col-span-2 min-h-12 self-end rounded-lg bg-brand px-4 font-semibold text-brand-ink sm:col-span-1 ${showPeriod ? '' : 'sm:col-start-5'}`}>
        {L.reports.show}
      </button>
    </form>
  );
}

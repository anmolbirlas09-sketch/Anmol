import { inputClass } from '@/components/ui';
import { L } from '@/lib/labels';
import type { ReportParams } from '@/lib/reports/model';
import type { Factory } from '@/lib/types';

const field = `${inputClass} mt-1 font-normal`;

/** Plain GET form: the filters live in the URL, so reports can be bookmarked and shared. */
export function ReportFilters({
  action, p, factories, lockedFactory, showPeriod, looms, qualities, specs, specsToggle, timed, groupBy,
}: {
  action: string;
  p: ReportParams;
  factories: Factory[];
  lockedFactory: boolean;
  showPeriod?: boolean;
  /** When given, also filter by loom, fabric quality and beam number. */
  looms?: { id: string; machine_no: string }[];
  qualities?: { id: string; name: string }[];
  specs?: { id: string; spec_code: string; fabric_quality_name: string }[];
  /** Offer "each specification under its parent" vs "parent qualities only". */
  specsToggle?: boolean;
  /** Time-of-day window and shift (time-stamped production reports). */
  timed?: boolean;
  /** Daily report: group rows by loom / quality / specification / beam. */
  groupBy?: boolean;
}) {
  const detailed = Boolean(looms && qualities);
  return (
    <form action={action} className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-4">
      <label className="text-sm font-semibold">
        {L.reports.from}
        <input type="date" name="from" defaultValue={p.from} className={field} />
      </label>
      <label className="text-sm font-semibold">
        {L.reports.to}
        <input type="date" name="to" defaultValue={p.to} className={field} />
      </label>
      <label className="text-sm font-semibold">
        {L.reports.factory}
        <select name="factory" defaultValue={p.factoryId ?? ''} disabled={lockedFactory} className={field}>
          <option value="">{L.app.allFactories}</option>
          {factories.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
        </select>
      </label>
      {showPeriod ? (
        <label className="text-sm font-semibold">
          {L.reports.period}
          <select name="period" defaultValue={p.period} className={field}>
            <option value="day">{L.reports.daily}</option>
            <option value="month">{L.reports.monthly}</option>
          </select>
        </label>
      ) : (
        <input type="hidden" name="period" value={p.period} />
      )}
      {detailed && (
        <>
          <label className="text-sm font-semibold">
            {L.reports.loom}
            <select name="loom" defaultValue={p.loomId ?? ''} className={field}>
              <option value="">{L.reports.any}</option>
              {looms!.map((l) => <option key={l.id} value={l.id}>{l.machine_no}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">
            {L.reports.quality}
            <select name="quality" defaultValue={p.fabricQualityId ?? ''} className={field}>
              <option value="">{L.reports.any}</option>
              {qualities!.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </label>
          {specs && (
            <label className="text-sm font-semibold">
              {L.reports.spec}
              <select name="spec" defaultValue={p.fabricSpecificationId ?? ''} className={field}>
                <option value="">{L.reports.any}</option>
                {specs.map((s) => <option key={s.id} value={s.id}>{s.spec_code} ({s.fabric_quality_name})</option>)}
              </select>
            </label>
          )}
          {specsToggle && (
            <label className="text-sm font-semibold">
              {L.spec.title}
              <select name="specs" defaultValue={p.showSpecs === false ? '0' : '1'} className={field}>
                <option value="1">{L.reports.showSpecs}</option>
                <option value="0">{L.reports.parentsOnly}</option>
              </select>
            </label>
          )}
          <label className="text-sm font-semibold">
            {L.reports.beamNo}
            <input name="beam" defaultValue={p.beamNo ?? ''} autoCapitalize="characters" className={field} />
          </label>
        </>
      )}
      {groupBy && (
        <label className="text-sm font-semibold">
          {L.reports.groupBy}
          <select name="group" defaultValue={p.group ?? 'loom'} className={field}>
            {Object.entries(L.reports.groups).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      {timed && (
        <>
          <label className="text-sm font-semibold">
            {L.reports.timeFrom}
            <input type="time" name="tfrom" defaultValue={p.timeFrom ?? ''} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {L.reports.timeTo}
            <input type="time" name="tto" defaultValue={p.timeTo ?? ''} className={field} />
          </label>
          <label className="text-sm font-semibold">
            {L.reports.shift}
            <select name="shift" defaultValue={p.shift ?? ''} className={field}>
              <option value="">{L.reports.any}</option>
              <option value="day">{L.takeoff.shifts.day}</option>
              <option value="night">{L.takeoff.shifts.night}</option>
            </select>
          </label>
        </>
      )}
      <button className="col-span-2 min-h-12 self-end rounded-lg bg-brand px-4 font-semibold text-brand-ink sm:col-span-1">
        {L.reports.show}
      </button>
    </form>
  );
}

'use client';

import { useActionState, useRef, useTransition } from 'react';
import { Notice, buttonClass, cx, inputClass } from '@/components/ui';
import { fmtDate, fmtKg, fmtM } from '@/lib/format';
import type { GreyImportRow, ImportKind, YarnImportRow } from '@/lib/importer';
import { L } from '@/lib/labels';
import { importAction, type ImportState } from './actions';

export function ImportForm({ kind }: { kind: ImportKind }) {
  const [state, action] = useActionState(importAction, {} as ImportState);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  // Submit by hand (not via the form's action prop) so the chosen file stays
  // selected between "Check file" and "Import".
  const submit = (commit: boolean) => {
    if (!form.current) return;
    const fd = new FormData(form.current);
    fd.set('commit', commit ? '1' : '0');
    start(() => action(fd));
  };

  const rows = state.rows ?? [];
  const errors = state.errors ?? [];
  const ready = state.checked && errors.length === 0 && rows.length > 0 && !state.imported;

  return (
    <form ref={form} onSubmit={(e) => { e.preventDefault(); submit(false); }} className="space-y-3" aria-label={kind === 'yarn' ? L.importer.yarn : L.importer.grey}>
      <input type="hidden" name="kind" value={kind} />
      <label className="block text-sm font-semibold">
        {L.importer.file}
        <input
          type="file"
          name="file"
          required
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className={cx(inputClass, 'mt-1 py-2 font-normal file:mr-3 file:rounded-md file:border-0 file:bg-brand-soft file:px-3 file:py-1.5 file:font-semibold file:text-brand')}
        />
      </label>
      <button type="submit" disabled={pending} className={cx(buttonClass.secondary, 'w-full')}>
        {pending ? L.importer.checking : L.importer.check}
      </button>

      {state.imported ? <Notice tone="ok">{L.importer.done(state.imported)}</Notice> : null}
      {state.error && <Notice tone="bad">{state.error}</Notice>}

      {state.checked && errors.length > 0 && (
        <div className="space-y-2">
          <Notice tone="bad">{L.importer.errorsFound(errors.length)}</Notice>
          <ul className="max-h-72 overflow-y-auto rounded-lg border border-line text-sm" aria-label="Problems">
            {errors.map((e, i) => (
              <li key={i} className="flex gap-3 border-b border-line px-3 py-2 last:border-0">
                <span className="tnum shrink-0 font-semibold">{L.importer.row} {e.row}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready && (
        <div className="space-y-2">
          <Notice tone="ok">{L.importer.ok}: {L.reports.rows(rows.length)}</Notice>
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="tnum w-full text-sm">
              <tbody className="divide-y divide-line">
                {rows.slice(0, 200).map((r) => (
                  <tr key={r.row}>
                    <td className="px-3 py-1.5 text-muted">{r.row}</td>
                    {kind === 'yarn' ? (
                      <>
                        <td className="px-3 py-1.5 font-semibold">{(r as YarnImportRow).lot_no}</td>
                        <td className="px-3 py-1.5">{(r as YarnImportRow).yarn_quality_name}</td>
                        <td className="px-3 py-1.5">{r.factory_code}</td>
                        <td className="px-3 py-1.5 text-right">{fmtKg((r as YarnImportRow).kgs_received)}</td>
                        <td className="px-3 py-1.5">{fmtDate((r as YarnImportRow).inward_date)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 font-semibold">{(r as GreyImportRow).fabric_quality_name} · {(r as GreyImportRow).spec_code}</td>
                        <td className="px-3 py-1.5">{r.factory_code}</td>
                        <td className="px-3 py-1.5 text-right">{fmtM((r as GreyImportRow).meters)} m</td>
                        <td className="px-3 py-1.5 text-right">{fmtKg((r as GreyImportRow).kgs)} kg</td>
                        <td className="px-3 py-1.5">{fmtDate((r as GreyImportRow).entry_date)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={pending} onClick={() => submit(true)} className={cx(buttonClass.primary, 'w-full')}>
            {pending ? L.importer.importing : L.importer.importN(rows.length)}
          </button>
        </div>
      )}
    </form>
  );
}

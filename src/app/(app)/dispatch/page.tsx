import type { Metadata } from 'next';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Card, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { listDispatches } from '@/lib/data/dispatch';
import { greyStock } from '@/lib/data/grey';
import { listFactories } from '@/lib/data/masters';
import { fmtDate, fmtKg, fmtM, todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { deleteDispatchAction } from './actions';
import { DispatchForm } from './DispatchForm';

export const metadata: Metadata = { title: L.dispatch.title };

export default async function DispatchPage({ searchParams }: PageProps<'/dispatch'>) {
  const user = await requireUser();
  const { error } = await searchParams;
  const db = await createClient();
  const factoryId = user.factory_id ?? undefined;
  const [stock, factories, recent] = await Promise.all([greyStock(db, { factoryId }), listFactories(db), listDispatches(db, { factoryId, limit: 20 })]);
  const allowed = user.factory_id ? factories.filter((f) => f.id === user.factory_id) : factories;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={L.dispatch.title} back="/grey" />
      {typeof error === 'string' && <div className="mb-4"><Notice tone="bad">{error}</Notice></div>}
      <Card>
        <DispatchForm stock={stock} factories={allowed} defaultFactoryId={user.factory_id ?? undefined} today={todayIST()} />
      </Card>

      <SectionTitle>{L.dispatch.recent}</SectionTitle>
      {recent.length === 0 ? (
        <p className="text-sm text-muted">{L.dispatch.none}</p>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {recent.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-semibold">{d.fabric_quality_name} <span className="font-normal text-muted">· {d.factory_code}</span></div>
                  <div className="truncate text-xs text-muted">
                    {fmtDate(d.entry_date)}{d.party ? ` · ${d.party}` : ''}{d.challan_no ? ` · ${d.challan_no}` : ''}{d.created_by_name ? ` · ${d.created_by_name}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="tnum text-right">
                    <div className="font-semibold">{fmtM(d.meters)} m</div>
                    <div className="text-xs text-muted">{fmtKg(d.kgs)} kg</div>
                  </div>
                  {canEdit(user) && (
                    <form action={deleteDispatchAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <ConfirmButton className="min-h-10 rounded-md px-2 text-sm font-semibold text-bad">{L.app.delete}</ConfirmButton>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

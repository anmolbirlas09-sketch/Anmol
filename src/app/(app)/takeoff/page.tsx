import type { Metadata } from 'next';
import { Card, Notice, PageHeader, SectionTitle } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { listLoomStatus, listTakeoffs } from '@/lib/data/looms';
import { todayIST } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { TakeoffForm } from '../looms/TakeoffForm';
import { TakeoffList } from '../looms/TakeoffList';

export const metadata: Metadata = { title: L.takeoff.title };

export default async function TakeoffPage({ searchParams }: PageProps<'/takeoff'>) {
  const user = await requireUser();
  const { loom, error } = await searchParams;
  const db = await createClient();
  const factoryId = user.factory_id ?? undefined;
  const [looms, recent] = await Promise.all([listLoomStatus(db, { factoryId }), listTakeoffs(db, { factoryId, limit: 10 })]);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={L.takeoff.title} />
      {typeof error === 'string' && (
        <div className="mb-4"><Notice tone="bad">{error}</Notice></div>
      )}
      <Card>
        <TakeoffForm
          looms={looms.filter((l) => l.status === 'running')}
          defaultLoomId={typeof loom === 'string' ? loom : undefined}
          today={todayIST()}
        />
      </Card>
      <SectionTitle>{L.takeoff.recent}</SectionTitle>
      <TakeoffList rows={recent} canDelete={canEdit(user)} returnTo="/takeoff" />
    </div>
  );
}

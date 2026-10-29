import type { Metadata } from 'next';
import { LinkButton, PageHeader, Segmented } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { listLoomStatus } from '@/lib/data/looms';
import { listFactories } from '@/lib/data/masters';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { LoomGrid } from './LoomGrid';

export const metadata: Metadata = { title: L.loom.title };

export default async function LoomsPage({ searchParams }: PageProps<'/looms'>) {
  const user = await requireUser();
  const { factory: f } = await searchParams;
  const db = await createClient();
  const factories = await listFactories(db);
  // Default the toggle to the user's own factory.
  const factory = f === 'all' ? undefined : typeof f === 'string' ? f : (user.factory_id ?? undefined);
  const looms = await listLoomStatus(db, { factoryId: factory });

  return (
    <>
      <PageHeader title={L.loom.title} subtitle={L.loom.tapForDetails} />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <LinkButton href="/takeoff">{L.takeoff.short}</LinkButton>
        <LinkButton href="/looms/load" variant="secondary">{L.loom.loadShort}</LinkButton>
      </div>
      <div className="mb-4">
        <Segmented
          label={L.beam.factory}
          items={[
            { href: '/looms?factory=all', label: L.app.all, active: !factory },
            ...factories.map((x) => ({ href: `/looms?factory=${x.id}`, label: x.code, active: factory === x.id })),
          ]}
        />
      </div>
      <LoomGrid looms={looms} />
    </>
  );
}

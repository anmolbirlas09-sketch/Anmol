import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { listLoomStatus, listPreparedBeams } from '@/lib/data/looms';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { LoadBeamForm } from '../LoadBeamForm';

export const metadata: Metadata = { title: L.loom.load };

export default async function LoadPage({ searchParams }: PageProps<'/looms/load'>) {
  const user = await requireUser();
  const { beam, loom } = await searchParams;
  const db = await createClient();
  const [beams, looms] = await Promise.all([listPreparedBeams(db), listLoomStatus(db, { factoryId: user.factory_id ?? undefined })]);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={L.loom.load} back="/looms" />
      <LoadBeamForm
        beams={beams}
        looms={looms.filter((l) => l.status === 'idle')}
        defaultBeamId={typeof beam === 'string' ? beam : undefined}
        defaultLoomId={typeof loom === 'string' ? loom : undefined}
      />
    </div>
  );
}

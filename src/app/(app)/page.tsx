import { LinkButton, Notice, SectionTitle, Stat } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { countBeamsByStatus } from '@/lib/data/beams';
import { yarnStockByQuality } from '@/lib/data/yarn';
import { fmtKg } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const user = await requireUser();
  const db = await createClient();
  const [stock, beams] = await Promise.all([yarnStockByQuality(db), countBeamsByStatus(db)]);
  const totalKg = stock.reduce((s, r) => s + Number(r.balance_kg), 0);
  const low = stock.filter((r) => r.is_low_stock);

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">
        {L.home.hello}, {user.name.split(' ')[0]}
      </h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={L.home.yarnStock} value={fmtKg(totalKg)} unit="kg" />
        <Stat label={L.home.beamsPrepared} value={String(beams.prepared)} />
        <Stat label={L.home.beamsRunning} value={String(beams.on_loom)} />
      </div>

      {low.length > 0 && (
        <div className="mt-4">
          <Notice tone="warn">
            {L.yarn.lowStock}: {low.map((r) => `${r.yarn_quality_name} (${fmtKg(r.balance_kg)} kg)`).join(', ')}
          </Notice>
        </div>
      )}

      <SectionTitle>{L.home.quickActions}</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <LinkButton href="/yarn/new">+ {L.yarn.newLot}</LinkButton>
        <LinkButton href="/beams/new">+ {L.beam.newBeam}</LinkButton>
        <LinkButton href="/yarn" variant="secondary">{L.yarn.title}</LinkButton>
        <LinkButton href="/beams" variant="secondary">{L.beam.title}</LinkButton>
      </div>
      <p className="mt-6 text-sm text-muted">{L.home.dashboardNote}</p>
    </>
  );
}

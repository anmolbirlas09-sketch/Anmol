import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { getVarianceThreshold } from '@/lib/data/settings';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { requireOwner } from '../owner';
import { GeneralForm } from '../SettingsForms';

export const metadata: Metadata = { title: L.settings.general };

export default async function GeneralSettingsPage() {
  await requireOwner();
  const threshold = await getVarianceThreshold(await createClient());
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={L.settings.general} back="/settings" subtitle={L.settings.generalHint} />
      <Card><GeneralForm threshold={threshold} /></Card>
    </div>
  );
}

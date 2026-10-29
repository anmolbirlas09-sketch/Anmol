import type { Metadata } from 'next';
import { Card, Notice, PageHeader } from '@/components/ui';
import { canEdit, requireUser } from '@/lib/auth';
import { L } from '@/lib/labels';
import { ImportForm } from './ImportForm';

export const metadata: Metadata = { title: L.importer.title };

export default async function ImportPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={L.importer.title} back="/more" />
      {!canEdit(user) ? (
        <Notice tone="neutral">{L.importer.who}</Notice>
      ) : (
        <div className="space-y-4">
          {(['yarn', 'grey'] as const).map((k) => (
            <Card key={k}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-bold">{k === 'yarn' ? L.importer.yarn : L.importer.grey}</h2>
                  <p className="text-sm text-muted">{k === 'yarn' ? L.importer.yarnHint : L.importer.greyHint}</p>
                </div>
                <a href={`/import/template/${k}`} className="text-sm font-semibold text-brand" download>
                  {L.importer.template} ↓
                </a>
              </div>
              <ImportForm kind={k} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

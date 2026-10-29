import { getCurrentUser } from '@/lib/auth';
import { importMasters } from '@/lib/data/imports';
import { SHEET_NAME, isImportKind, templateWorkbook } from '@/lib/importer';
import { createClient } from '@/lib/supabase/server';

/** Template with today's masters in the dropdown lists. */
export async function GET(_: Request, ctx: RouteContext<'/import/template/[kind]'>) {
  const { kind } = await ctx.params;
  if (!isImportKind(kind)) return new Response('Unknown template', { status: 404 });
  const user = await getCurrentUser();
  if (!user?.active) return new Response('Sign in first', { status: 401 });
  const m = await importMasters(await createClient(), user.factory_id);
  const buf = await templateWorkbook(kind, m).xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${SHEET_NAME[kind].toLowerCase().replace(' ', '-')}-template.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}

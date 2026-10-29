import { getCurrentUser } from '@/lib/auth';
import { listFactories } from '@/lib/data/masters';
import { buildReport } from '@/lib/reports/build';
import { reportToPdf, reportToXlsx } from '@/lib/reports/export';
import { fileNameFor, isReportKind } from '@/lib/reports/model';
import { reportParams } from '@/lib/reports/params';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request, ctx: RouteContext<'/reports/[kind]/export'>) {
  const { kind } = await ctx.params;
  if (!isReportKind(kind)) return new Response('Unknown report', { status: 404 });
  const user = await getCurrentUser();
  if (!user?.active) return new Response('Sign in first', { status: 401 });

  const url = new URL(request.url);
  const db = await createClient();
  const factories = await listFactories(db);
  const p = reportParams(Object.fromEntries(url.searchParams), factories, user.factory_id);
  const report = await buildReport(db, kind, p);

  const pdf = url.searchParams.get('format') === 'pdf';
  const body = pdf ? reportToPdf(report) : await reportToXlsx(report);
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileNameFor(report, p, pdf ? 'pdf' : 'xlsx')}"`,
      'cache-control': 'no-store',
    },
  });
}

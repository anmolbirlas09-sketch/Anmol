'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { deleteTakeoff, finishBeam, loadBeam, recordProduction, unloadBeam } from '@/lib/data/looms';
import { friendlyError, notAllowed } from '@/lib/errors';
import { fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { formValues, loadBeamSchema, parseForm, productionSchema, type FormState } from '@/lib/validation';

const safePath = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : null);

function revalidateFloor() {
  for (const p of ['/', '/looms', '/beams', '/grey', '/takeoff']) revalidatePath(p, 'layout');
}

export async function loadBeamAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(loadBeamSchema, form);
  if (parsed.error) return parsed.error;
  try {
    // A busy loom without a choice for its running beam is refused by the database with a clear message.
    await loadBeam(await createClient(), parsed.data.beam_id, parsed.data.loom_id, parsed.data.replace);
  } catch (e) {
    return { error: friendlyError(e), values: formValues(form) };
  }
  revalidateFloor();
  redirect(`/looms/${parsed.data.loom_id}?loaded=1`);
}

export async function productionAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(productionSchema, form);
  if (parsed.error) return parsed.error;
  const p = parsed.data;
  let saved;
  try {
    saved = await recordProduction(await createClient(), p);
  } catch (e) {
    return { error: friendlyError(e), values: formValues(form) };
  }
  revalidateFloor();
  const machine = String(form.get('machine_no') ?? '');
  const beamNo = String(form.get('beam_no') ?? '');
  const back = safePath(form.get('return'));
  // On a loom page the form disappears once the beam is finished, so say it on the page itself.
  if (p.finish_beam && back) redirect(`${back}?finished=${encodeURIComponent(beamNo)}`);
  const what = saved.net_meters !== null
    ? L.production.saved(fmtM(saved.net_meters), saved.roll_count, machine)
    : L.production.savedReading(fmtM(saved.counter_reading), machine);
  return {
    ok: true,
    message: p.finish_beam ? `${what}. ${L.takeoff.savedFinished(beamNo)}` : what,
    // keep loom, date, roll length, GSM and width for the next entry (time and shift follow the clock)
    values: {
      loom_id: p.loom_id, entry_date: p.entry_date ?? '', finished: p.finish_beam ? '1' : '',
      roll_length_m: p.roll_length_m !== undefined ? String(p.roll_length_m) : '', gsm: p.gsm !== undefined ? String(p.gsm) : '', width_m: p.width_m !== undefined ? String(p.width_m) : '',
    },
  };
}

/** Run a button action; on failure come back to the page with the reason in ?error=. */
async function act(form: FormData, fallback: string, fn: (db: Awaited<ReturnType<typeof createClient>>) => Promise<unknown>) {
  const back = safePath(form.get('return')) ?? fallback;
  let error: string | null = null;
  try {
    await fn(await createClient());
  } catch (e) {
    error = friendlyError(e);
  }
  revalidateFloor();
  const sep = back.includes('?') ? '&' : '?';
  redirect(error ? `${back}${sep}error=${encodeURIComponent(error)}` : back);
}

export async function finishBeamAction(form: FormData): Promise<void> {
  const beamId = String(form.get('beam_id') ?? '');
  await act(form, `/beams/${beamId}`, (db) => finishBeam(db, beamId));
}

export async function unloadBeamAction(form: FormData): Promise<void> {
  const beamId = String(form.get('beam_id') ?? '');
  await act(form, `/beams/${beamId}`, (db) => unloadBeam(db, beamId));
}

export async function deleteTakeoffAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  await act(form, '/takeoff', async (db) => {
    if (!(await deleteTakeoff(db, id))) throw notAllowed();
  });
}

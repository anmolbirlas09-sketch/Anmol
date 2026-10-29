'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { deleteTakeoff, finishBeam, loadBeam, recordTakeoff, unloadBeam } from '@/lib/data/looms';
import { friendlyError, notAllowed } from '@/lib/errors';
import { fmtKg, fmtM } from '@/lib/format';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { formValues, loadBeamSchema, parseForm, takeoffSchema, type FormState } from '@/lib/validation';

const safePath = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : null);

function revalidateFloor() {
  for (const p of ['/', '/looms', '/beams', '/grey', '/takeoff']) revalidatePath(p, 'layout');
}

export async function loadBeamAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(loadBeamSchema, form);
  if (parsed.error) return parsed.error;
  try {
    await loadBeam(await createClient(), parsed.data.beam_id, parsed.data.loom_id);
  } catch (e) {
    return { error: friendlyError(e), values: formValues(form) };
  }
  revalidateFloor();
  redirect(`/looms/${parsed.data.loom_id}?loaded=1`);
}

export async function takeoffAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(takeoffSchema, form);
  if (parsed.error) return parsed.error;
  const t = parsed.data;
  try {
    await recordTakeoff(await createClient(), t);
  } catch (e) {
    return { error: friendlyError(e), values: formValues(form) };
  }
  revalidateFloor();
  const machine = String(form.get('machine_no') ?? '');
  const back = safePath(form.get('return'));
  // On a loom page the form disappears once the beam is finished, so say it on the page itself.
  if (t.finish_beam && back) redirect(`${back}?finished=${encodeURIComponent(String(form.get('beam_no') ?? ''))}`);
  const beamNo = String(form.get('beam_no') ?? '');
  return {
    ok: true,
    message: t.finish_beam ? L.takeoff.savedFinished(beamNo) : L.takeoff.saved(fmtM(t.meters), fmtKg(t.kgs), machine),
    // keep loom, date and shift for the next roll
    values: { loom_id: t.loom_id, entry_date: t.entry_date, shift: t.shift ?? '', finished: t.finish_beam ? '1' : '' },
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
  await act(form, `/beams/${beamId}`, async (db) => {
    if (!(await unloadBeam(db, beamId))) throw notAllowed();
  });
}

export async function deleteTakeoffAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  await act(form, '/takeoff', async (db) => {
    if (!(await deleteTakeoff(db, id))) throw notAllowed();
  });
}

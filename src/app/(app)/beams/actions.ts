'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { addConsumption, createBeam, deleteConsumption, getBeamSummary, updateBeam } from '@/lib/data/beams';
import type { Db } from '@/lib/data/client';
import { getLoomStatus, loadBeam } from '@/lib/data/looms';
import { saveSpecification } from '@/lib/data/masters';
import { getLotBalance } from '@/lib/data/yarn';
import { DataError, friendlyError } from '@/lib/errors';
import { L } from '@/lib/labels';
import { createClient } from '@/lib/supabase/server';
import { BEAM_CARD_COLUMNS, beamCardSchema, consumptionSchema, formValues, parseForm, type BeamCardInput, type BeamRow, type FormState } from '@/lib/validation';

/**
 * The specification the card points at. "new" creates one under the chosen
 * quality from the card's reed / ends per inch / yarns (or reuses an identical
 * one). Staff who may not add specifications keep those values on the card.
 */
async function resolveCardSpec(db: Db, v: BeamCardInput): Promise<{ specId: string | null; onCard: boolean }> {
  if (v.fabric_specification_id !== 'new') return { specId: v.fabric_specification_id ?? null, onCard: !v.fabric_specification_id };
  const fields = { reed: v.reed ?? null, ends_per_inch: v.spec_epi ?? null, warp_yarn_quality_id: v.warp_yarn_quality_id ?? null, weft_yarn_quality_id: v.weft_yarn_quality_id ?? null };
  try {
    return { specId: await saveSpecification(db, { fabric_quality_id: v.fabric_quality_id!, ...fields, active: true }), onCard: false };
  } catch (e) {
    const code = e instanceof DataError ? e.db?.code : undefined;
    if (code === '23505') {
      // Same combination already exists under this quality: use it.
      let q = db.from('fabric_specifications').select('id').eq('fabric_quality_id', v.fabric_quality_id!);
      for (const [k, val] of Object.entries(fields)) q = val === null ? q.is(k, null) : q.eq(k, val);
      const { data } = await q.limit(1);
      if (data?.[0]) return { specId: data[0].id as string, onCard: false };
    }
    if (code === '42501') return { specId: null, onCard: true };
    throw e;
  }
}

/** Create or edit a beam card; optionally load it on a loom (replacing the running beam). */
export async function saveBeamCardAction(beamId: string | null, _: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(beamCardSchema, form);
  if (parsed.error) return parsed.error;
  const v = parsed.data;
  const user = await requireUser();
  const db = await createClient();
  const values = formValues(form);

  // A busy loom needs a decision about its running beam before anything is saved.
  const loom = v.loom_id ? await getLoomStatus(db, v.loom_id) : null;
  if (v.loom_id && !loom) return { fieldErrors: { loom_id: L.errors.notFound }, values };
  if (loom?.beam_id && loom.beam_id !== beamId && !v.replace) return { fieldErrors: { replace: L.card.replaceNeeded(loom.machine_no, loom.beam_no ?? '') }, values };

  const existing = beamId ? await getBeamSummary(db, beamId) : null;
  if (beamId && !existing) return { error: L.errors.notFound, values };

  let saved: { id: string; beam_no: string };
  try {
    const { specId, onCard } = await resolveCardSpec(db, v);
    const row: BeamRow = {};
    for (const k of BEAM_CARD_COLUMNS) row[k] = (v as Record<string, string | number | undefined>)[k] ?? null;
    row.fabric_specification_id = specId;
    if (!onCard) {
      // The specification holds reed and yarns; the card does not repeat them.
      row.reed = null;
      row.warp_yarn_quality_id = null;
      row.weft_yarn_quality_id = null;
    }
    // Where the beam is: the loom's shed; else the user's own shed; else what the owner chose (or none yet).
    row.factory_id = loom?.factory_id ?? user.factory_id ?? v.factory_id ?? null;
    if (existing && existing.status !== 'prepared') delete row.factory_id;   // follows its loom

    if (existing) {
      if (!(await updateBeam(db, existing.beam_id, row))) return { error: L.card.editOnlySupervisor, values };
      saved = { id: existing.beam_id, beam_no: row.beam_no ? String(row.beam_no) : existing.beam_no };
    } else {
      saved = await createBeam(db, row);
    }
  } catch (e) {
    const error = friendlyError(e);
    const field = /beam no/i.test(error) ? { beam_no: error } : undefined;
    return { error: field ? undefined : error, fieldErrors: field, values };
  }

  let loadError: string | null = null;
  if (loom && loom.beam_id !== saved.id && (!existing || existing.status === 'prepared')) {
    try {
      await loadBeam(db, saved.id, loom.loom_id, v.replace);
    } catch (e) {
      loadError = friendlyError(e);
    }
  }
  for (const p of ['/', '/beams', '/looms', '/grey', '/takeoff']) revalidatePath(p, 'layout');
  const q = loadError ? `error=${encodeURIComponent(L.card.savedNotLoaded(saved.beam_no, loadError))}` : 'saved=1';
  redirect(`/beams/${saved.id}?${q}`);
}

export async function addConsumptionAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(consumptionSchema, form);
  if (parsed.error) return parsed.error;
  try {
    await addConsumption(await createClient(), parsed.data);
  } catch (e) {
    const error = friendlyError(e);
    return { fieldErrors: { kgs: error }, values: formValues(form) };
  }
  revalidatePath(`/beams/${parsed.data.beam_id}`);
  revalidatePath('/yarn');
  // Keep the usage type and date for the next line; clear lot and kg.
  return { ok: true, message: L.beam.lineAdded, values: { usage_type: parsed.data.usage_type, entry_date: parsed.data.entry_date } };
}

export async function deleteConsumptionAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const beamId = String(form.get('beam_id') ?? '');
  await deleteConsumption(await createClient(), id);
  revalidatePath(`/beams/${beamId}`);
  revalidatePath('/yarn');
}

/** Fresh balance for one lot, so the form shows what is available right now. */
export async function lotAvailableAction(lotId: string): Promise<number | null> {
  const lot = await getLotBalance(await createClient(), lotId).catch(() => null);
  return lot ? Number(lot.balance_kg) : null;
}

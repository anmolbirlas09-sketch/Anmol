'use client';

import { L } from '@/lib/labels';
import type { FabricSpecification } from '@/lib/types';
import { Field, Notice, inputClass } from './ui';

const S = L.spec;
const v = (n: number | null) => (n === null ? S.notSet : String(n));

/** Reed, ends per inch, warp and weft of the chosen specification. */
export function SpecDetails({ spec }: { spec: Pick<FabricSpecification, 'spec_code' | 'reed' | 'ends_per_inch' | 'warp_yarn_quality_name' | 'weft_yarn_quality_name'> }) {
  return (
    <dl className="tnum grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-sunken p-3 text-sm sm:grid-cols-4" data-testid="spec-details">
      <div><dt className="text-muted">{S.reed}</dt><dd className="font-bold">{v(spec.reed)}</dd></div>
      <div><dt className="text-muted">{S.epi}</dt><dd className="font-bold">{v(spec.ends_per_inch)}</dd></div>
      <div><dt className="text-muted">{S.weft}</dt><dd className="font-semibold">{spec.weft_yarn_quality_name ?? S.notSet}</dd></div>
      <div><dt className="text-muted">{S.warp}</dt><dd className="font-semibold">{spec.warp_yarn_quality_name ?? S.notSet}</dd></div>
    </dl>
  );
}

/**
 * Parent fabric quality → its specification. Controlled: the parent form keeps
 * both ids so it can react (planned kg, stock shown, …).
 */
export function SpecPicker({
  qualities, specs, qualityId, specId, onQuality, onSpec, errors = {}, specFilter,
}: {
  qualities: { id: string; name: string }[];
  specs: FabricSpecification[];
  qualityId: string;
  specId: string;
  onQuality: (id: string) => void;
  onSpec: (id: string) => void;
  errors?: Record<string, string | undefined>;
  /** Limit the specifications offered (e.g. only those with stock). */
  specFilter?: (s: FabricSpecification) => boolean;
}) {
  const options = specs.filter((s) => s.fabric_quality_id === qualityId && (specFilter ? specFilter(s) : s.active));
  const spec = specs.find((s) => s.id === specId);

  return (
    <div className="space-y-3">
      <Field label={L.production.fabricQuality} htmlFor="fabric_quality_id" error={errors.fabric_quality_id}>
        <select
          id="fabric_quality_id"
          name="fabric_quality_id"
          value={qualityId}
          onChange={(e) => {
            onQuality(e.target.value);
            const own = specs.filter((s) => s.fabric_quality_id === e.target.value && (specFilter ? specFilter(s) : s.active));
            onSpec(own.length === 1 ? own[0].id : ''); // one spec → pick it
          }}
          className={inputClass}
        >
          <option value="">{L.app.select}</option>
          {qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>
      </Field>
      <Field label={S.pick} htmlFor="fabric_specification_id" error={errors.fabric_specification_id}
        hint={!qualityId ? S.pickFirstQuality : undefined}>
        <select
          id="fabric_specification_id"
          name="fabric_specification_id"
          value={specId}
          onChange={(e) => onSpec(e.target.value)}
          disabled={!qualityId}
          className={inputClass}
        >
          <option value="">{L.app.select}</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.spec_code} — {S.summary(v(s.reed), v(s.ends_per_inch))}
            </option>
          ))}
        </select>
      </Field>
      {qualityId && options.length === 0 && <Notice tone="warn">{S.noneForQuality}</Notice>}
      {spec && <SpecDetails spec={spec} />}
    </div>
  );
}

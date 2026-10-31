import Link from 'next/link';
import { L } from '@/lib/labels';
import type { FabricSpecification } from '@/lib/types';
import { Badge, cx } from './ui';

const S = L.spec;
const n = (v: number | null) => (v === null ? <span className="text-muted">{S.notSet}</span> : String(v));

/** Specifications of one parent quality: ID, reed and ends per inch side by side, yarns. */
export function SpecList({ specs, editHref }: { specs: FabricSpecification[]; editHref?: (s: FabricSpecification) => string }) {
  if (!specs.length) return <p className="px-4 py-3 text-sm text-muted">{S.none}</p>;
  return (
    <ul className="divide-y divide-line" aria-label={S.title}>
      {specs.map((s) => {
        const body = (
          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
            <span className="flex items-center gap-2 font-semibold">
              {s.spec_code}
              {!s.active && <Badge>{S.inactive}</Badge>}
            </span>
            <span className="tnum text-right text-sm">
              <span className="text-muted">{S.reed}</span> <b>{n(s.reed)}</b>
              <span className="ml-3 text-muted">{S.epiShort}</span> <b>{n(s.ends_per_inch)}</b>
            </span>
            <span className="col-span-2 truncate text-xs text-muted">
              {S.yarns(s.warp_yarn_quality_name ?? S.notSet, s.weft_yarn_quality_name ?? S.notSet)}
            </span>
          </div>
        );
        return (
          <li key={s.id} data-spec={s.spec_code}>
            {editHref ? (
              <Link href={editHref(s)} className={cx('flex min-h-14 items-center gap-2 px-4 py-2 hover:bg-sunken', !s.active && 'opacity-70')}>
                {body}
                <span aria-hidden className="text-muted">›</span>
              </Link>
            ) : (
              <div className={cx('flex min-h-14 items-center px-4 py-2', !s.active && 'opacity-70')}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

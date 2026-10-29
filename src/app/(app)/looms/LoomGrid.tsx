import Link from 'next/link';
import { cx } from '@/components/ui';
import type { LoomStatusRow } from '@/lib/types';
import { FactoryHeading, LoomTileBody, gridClass, groupByFactory, tileBase, tileClass, tileLabel } from './LoomTile';

/** One tile per loom, coloured by status; tap for the loom page. */
export function LoomGrid({ looms }: { looms: LoomStatusRow[] }) {
  return (
    <div className="space-y-5">
      {groupByFactory(looms).map(([code, list]) => (
        <section key={code} aria-label={code}>
          <FactoryHeading code={code} list={list} />
          <ul className={gridClass}>
            {list.map((l) => (
              <li key={l.loom_id}>
                <Link href={`/looms/${l.loom_id}`} data-status={l.status} aria-label={tileLabel(l)} className={cx(tileBase, tileClass[l.status])}>
                  <LoomTileBody loom={l} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

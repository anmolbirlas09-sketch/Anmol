import { Badge, type Tone } from '@/components/ui';
import { L } from '@/lib/labels';
import type { BeamStatus } from '@/lib/types';

const tone: Record<BeamStatus, Tone> = { prepared: 'warn', on_loom: 'ok', finished: 'neutral' };

/** unloaded: off the loom unfinished, with production already recorded. */
export function BeamStatusBadge({ status, unloaded }: { status: BeamStatus; unloaded?: boolean }) {
  return <Badge tone={tone[status]}>{unloaded ? L.beam.unloadedTag : L.beam.statuses[status]}</Badge>;
}

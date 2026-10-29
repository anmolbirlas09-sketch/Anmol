import { Badge, type Tone } from '@/components/ui';
import { L } from '@/lib/labels';
import type { BeamStatus } from '@/lib/types';

const tone: Record<BeamStatus, Tone> = { prepared: 'warn', on_loom: 'ok', finished: 'neutral' };

export function BeamStatusBadge({ status }: { status: BeamStatus }) {
  return <Badge tone={tone[status]}>{L.beam.statuses[status]}</Badge>;
}

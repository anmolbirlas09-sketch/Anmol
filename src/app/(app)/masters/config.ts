import { L } from '@/lib/labels';

export const MASTER_KINDS = {
  'yarn-qualities': { table: 'yarn_qualities', title: L.masters.yarnQualities },
  'fabric-qualities': { table: 'fabric_qualities', title: L.masters.fabricQualities },
  suppliers: { table: 'suppliers', title: L.masters.suppliers },
} as const;

export type MasterKind = keyof typeof MASTER_KINDS;
export const isMasterKind = (k: string): k is MasterKind => k in MASTER_KINDS;

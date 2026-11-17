import type { WorkoutItem } from '../../domain/types';

/** Um exercício sozinho, ou os exercícios de um bi-set/circuito executados juntos. */
export interface Block {
  id: string;
  items: WorkoutItem[];
}

/** Agrupa por `blockId` na ordem em que cada bloco aparece; dentro do bloco, pela ordem do personal. */
export function groupBlocks(items: WorkoutItem[]): Block[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const blocks: Block[] = [];
  const byId = new Map<string, Block>();
  for (const item of sorted) {
    let block = byId.get(item.blockId);
    if (!block) {
      block = { id: item.blockId, items: [] };
      byId.set(item.blockId, block);
      blocks.push(block);
    }
    block.items.push(item);
  }
  return blocks;
}

/** 'bi-set' (2 exercícios), 'circuito' (3 ou mais) ou null para exercício isolado. */
export function blockKind(block: Block): 'bi-set' | 'circuito' | null {
  if (block.items.length === 2) return 'bi-set';
  if (block.items.length > 2) return 'circuito';
  return null;
}

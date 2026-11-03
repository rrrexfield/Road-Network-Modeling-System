import type { TopologyWay } from './build-topology.js';

export interface StructureConflict {
  nodeId: number;
  reason: 'incompatible-interior-structure';
  ways: { wayId: number; bridge: string; tunnel: string; layer: string }[];
}

/** 检查不同道路的内部共享节点结构差异，排除普通桥隧端点衔接；只报告疑点，不擅自断边。 */
export function diagnoseStructureConflicts(ways: readonly TopologyWay[]): StructureConflict[] {
  const candidates = new Set<number>();
  for (const way of ways) {
    if (
      (way.tags.bridge && way.tags.bridge !== 'no') ||
      (way.tags.tunnel && way.tags.tunnel !== 'no')
    ) {
      for (let i = 1; i + 1 < way.nds.length; i++) candidates.add(way.nds[i]!);
    }
  }
  const byNode = new Map<number, Map<number, StructureConflict['ways'][number]>>();
  for (const way of ways)
    for (let i = 1; i + 1 < way.nds.length; i++) {
      const node = way.nds[i]!;
      if (!candidates.has(node)) continue;
      const group = byNode.get(node) ?? new Map();
      group.set(way.id, {
        wayId: way.id,
        bridge: way.tags.bridge ?? 'no',
        tunnel: way.tags.tunnel ?? 'no',
        layer: way.tags.layer ?? '0',
      });
      byNode.set(node, group);
    }
  const result: StructureConflict[] = [];
  for (const [nodeId, group] of byNode) {
    const descriptions = [...group.values()];
    if (
      descriptions.some((a) =>
        descriptions.some(
          (b) =>
            a.wayId !== b.wayId &&
            (a.layer !== b.layer ||
              (a.bridge === 'no') !== (b.bridge === 'no') ||
              (a.tunnel === 'no') !== (b.tunnel === 'no')),
        ),
      )
    ) {
      result.push({ nodeId, reason: 'incompatible-interior-structure', ways: descriptions });
    }
  }
  return result.sort((a, b) => a.nodeId - b.nodeId);
}

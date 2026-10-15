import type { TopologyStats } from '@gisalgo/shared';
import { Graph } from './graph.js';

/** 弱连通分量（并查集，边视为无向）。 */
export function connectedComponents(graph: Graph): { count: number; largestSize: number } {
  const parent = new Map<number, number>();
  const size = new Map<number, number>();

  const find = (x: number): number => {
    let root = x;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    while (parent.get(x)! !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (size.get(ra)! < size.get(rb)!) [ra, rb] = [rb, ra];
    parent.set(rb, ra);
    size.set(ra, size.get(ra)! + size.get(rb)!);
  };

  for (const id of graph.nodes()) {
    parent.set(id, id);
    size.set(id, 1);
  }
  for (const e of graph.edges()) union(e.from, e.to);

  const roots = new Set<number>();
  for (const id of graph.nodes()) roots.add(find(id));
  let largestSize = 0;
  for (const r of roots) largestSize = Math.max(largestSize, size.get(r)!);
  return { count: roots.size, largestSize };
}

/** 度（入度 + 出度）分布：度 → 节点数。 */
export function degreeDistribution(graph: Graph): Map<number, number> {
  const dist = new Map<number, number>();
  for (const id of graph.nodes()) {
    const d = graph.inDegree(id) + graph.outDegree(id);
    dist.set(d, (dist.get(d) ?? 0) + 1);
  }
  return dist;
}

/** 聚合拓扑统计：连通分量 + 度分布。悬挂/孤立节点由度分布直接读出
 *  （有向度 = 1 / 0；自环节点度为 2，不会落入这两档）。 */
export function computeTopologyStats(graph: Graph): TopologyStats {
  const { count, largestSize } = connectedComponents(graph);
  const dist = degreeDistribution(graph);
  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    connectedComponentCount: count,
    largestComponentSize: largestSize,
    danglingNodeCount: dist.get(1) ?? 0,
    isolatedNodeCount: dist.get(0) ?? 0,
    averageDegree: graph.nodeCount === 0 ? 0 : (2 * graph.edgeCount) / graph.nodeCount,
    degreeDistribution: dist,
  };
}

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

/** 悬挂节点：恰有一条关联边（入度 + 出度 = 1）。 */
export function danglingNodes(graph: Graph): number[] {
  const out: number[] = [];
  for (const id of graph.nodes()) {
    if (graph.inDegree(id) + graph.outDegree(id) === 1) out.push(id);
  }
  return out;
}

export function computeTopologyStats(graph: Graph): TopologyStats {
  const { count, largestSize } = connectedComponents(graph);
  let dangling = 0;
  let isolated = 0;
  const dist = new Map<number, number>();
  for (const id of graph.nodes()) {
    const d = graph.inDegree(id) + graph.outDegree(id);
    dist.set(d, (dist.get(d) ?? 0) + 1);
    if (d === 1) dangling += 1;
    if (d === 0) isolated += 1;
  }
  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    connectedComponentCount: count,
    largestComponentSize: largestSize,
    danglingNodeCount: dangling,
    isolatedNodeCount: isolated,
    averageDegree: graph.nodeCount === 0 ? 0 : (2 * graph.edgeCount) / graph.nodeCount,
    degreeDistribution: dist,
  };
}

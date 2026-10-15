import type { TopologyStats } from '@gisalgo/shared';
import { Graph } from './graph.js';

/** 弱连通分量（并查集，边视为无向）。内部按稠密下标使用类型化数组。 */
export function connectedComponents(graph: Graph): { count: number; largestSize: number } {
  const n = graph.nodeCount;
  const parent = new Int32Array(n);
  const size = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
    size[i] = 1;
  }

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (size[ra]! < size[rb]!) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    size[ra] = size[ra]! + size[rb]!;
  };

  for (const e of graph.edges()) {
    union(graph.indexOf(e.from)!, graph.indexOf(e.to)!); // addEdge 已校验端点存在
  }

  const roots = new Set<number>();
  for (let i = 0; i < n; i++) roots.add(find(i));
  let largestSize = 0;
  for (const r of roots) largestSize = Math.max(largestSize, size[r]!);
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

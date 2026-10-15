import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { Graph, computeTopologyStats } from './index.js';

function edge(id: number, from: number, to: number): RoadEdge {
  return { id, from, to, wayId: 1 };
}

describe('components', () => {
  it('连通分量与度统计', () => {
    const nodes = new Map<number, [number, number]>([
      [1, [30.0, 114.0]],
      [2, [30.0, 114.1]],
      [3, [30.0, 114.2]],
      [4, [30.0, 114.3]],
    ]);
    const g = new Graph(nodes, [edge(0, 1, 2), edge(1, 2, 1), edge(2, 2, 3), edge(3, 3, 2)]);
    const stats = computeTopologyStats(g);
    expect(stats.nodeCount).toBe(4);
    expect(stats.edgeCount).toBe(4);
    expect(stats.connectedComponentCount).toBe(2);
    expect(stats.largestComponentSize).toBe(3);
    expect(stats.danglingNodeCount).toBe(0);
    expect(stats.isolatedNodeCount).toBe(1);
    expect(stats.averageDegree).toBe(2);
    expect(stats.degreeDistribution.get(2)).toBe(2);
    expect(stats.degreeDistribution.get(4)).toBe(1);
    expect(stats.degreeDistribution.get(0)).toBe(1);
  });

  it('悬挂/孤立节点由度分布读出（单向链两端度 = 1）', () => {
    const nodes = new Map<number, [number, number]>([
      [1, [30.0, 114.0]],
      [2, [30.0, 114.1]],
      [3, [30.0, 114.2]],
    ]);
    const g = new Graph(nodes, [edge(0, 1, 2), edge(1, 2, 3)]);
    const stats = computeTopologyStats(g);
    expect(stats.danglingNodeCount).toBe(2);
    expect(stats.isolatedNodeCount).toBe(0);
    expect(stats.degreeDistribution.get(1)).toBe(2);
  });
});

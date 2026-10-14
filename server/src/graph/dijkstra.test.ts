import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { Graph, dijkstra } from './index.js';

const nodes = new Map<number, [number, number]>([
  [1, [30.0, 114.0]],
  [2, [30.0, 114.1]],
  [3, [30.0, 114.2]],
  [4, [30.0, 114.3]],
]);

const edges: RoadEdge[] = [
  { id: 0, from: 1, to: 2, wayId: 1 },
  { id: 1, from: 1, to: 3, wayId: 1 },
  { id: 2, from: 2, to: 3, wayId: 1 },
  { id: 3, from: 2, to: 4, wayId: 1 },
  { id: 4, from: 3, to: 4, wayId: 1 },
];

const weights = new Map<number, number>([
  [0, 1],
  [1, 4],
  [2, 2],
  [3, 5],
  [4, 1],
]);

const graph = new Graph(nodes, edges);
const weight = (e: RoadEdge): number => weights.get(e.id)!;

describe('dijkstra', () => {
  it('求出自定义权重下的最短路径', () => {
    const r = dijkstra(graph, 1, 4, weight);
    expect(r.distance).toBe(4);
    expect(r.nodeIds).toEqual([1, 2, 3, 4]);
    expect(r.edgeIds).toEqual([0, 2, 4]);
  });

  it('source === target 距离为 0', () => {
    const r = dijkstra(graph, 2, 2, weight);
    expect(r.distance).toBe(0);
    expect(r.nodeIds).toEqual([2]);
    expect(r.edgeIds).toEqual([]);
  });

  it('不可达返回 Infinity 与空序列', () => {
    const r = dijkstra(graph, 4, 1, weight);
    expect(r.distance).toBe(Infinity);
    expect(r.nodeIds).toEqual([]);
    expect(r.edgeIds).toEqual([]);
  });

  it('缺失源/目标返回 Infinity', () => {
    expect(dijkstra(graph, 999, 4, weight).distance).toBe(Infinity);
    expect(dijkstra(graph, 1, 999, weight).distance).toBe(Infinity);
  });

  it('默认权重为 Haversine 距离且为正', () => {
    const r = dijkstra(graph, 1, 4);
    expect(r.distance).toBeGreaterThan(0);
    expect(r.nodeIds[0]).toBe(1);
    expect(r.nodeIds[r.nodeIds.length - 1]).toBe(4);
  });
});

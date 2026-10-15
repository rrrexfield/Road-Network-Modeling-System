import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { Graph } from './index.js';

const nodes = new Map<number, [number, number]>([
  [1, [30.0, 114.0]],
  [2, [30.0, 114.1]],
  [3, [30.0, 114.2]],
]);

function edge(id: number, from: number, to: number): RoadEdge {
  return { id, from, to, wayId: 1 };
}

describe('Graph', () => {
  it('构造后统计与邻接正确', () => {
    const g = new Graph(nodes, [edge(0, 1, 2), edge(1, 2, 3), edge(2, 2, 1)]);
    expect(g.nodeCount).toBe(3);
    expect(g.edgeCount).toBe(3);
    expect(g.outEdges(2).map((e) => e.to)).toEqual([3, 1]);
    expect(g.outDegree(2)).toBe(2);
    expect(g.inDegree(2)).toBe(1);
    expect(g.outDegree(3)).toBe(0);
    expect(g.inDegree(3)).toBe(1);
  });

  it('coordinates 返回 [lat, lon]', () => {
    const g = new Graph(nodes, []);
    const c = g.coordinates(2)!;
    expect(c[0]).toBeCloseTo(30.0, 6);
    expect(c[1]).toBeCloseTo(114.1, 5); // Float32 约 7 位有效数字
    expect(g.coordinates(999)).toBeUndefined();
  });

  it('addNode / addEdge / removeEdge', () => {
    const g = new Graph(nodes, []);
    g.addNode(4, [30.0, 114.3]);
    g.addEdge(edge(10, 3, 4));
    expect(g.nodeCount).toBe(4);
    expect(g.edgeCount).toBe(1);
    expect(g.outEdges(3).map((e) => e.to)).toEqual([4]);
    expect(g.removeEdge(10)).toBe(true);
    expect(g.removeEdge(10)).toBe(false);
    expect(g.edgeCount).toBe(0);
  });

  it('addEdge 端点缺失时抛错', () => {
    const g = new Graph(nodes, []);
    expect(() => g.addEdge(edge(0, 1, 999))).toThrow();
  });

  it('addNode 坐标非法时抛错且不产生节点', () => {
    const g = new Graph(nodes, []);
    expect(() => g.addNode(9, [NaN, 114.0])).toThrow();
    expect(() => g.addNode(9, [30.0, Infinity])).toThrow();
    expect(g.hasNode(9)).toBe(false);
    expect(g.nodeCount).toBe(3);
  });

  it('hasNode 与节点迭代', () => {
    const g = new Graph(nodes, []);
    expect(g.hasNode(2)).toBe(true);
    expect(g.hasNode(5)).toBe(false);
    expect([...g.nodes()].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});

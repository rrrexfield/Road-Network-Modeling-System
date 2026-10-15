import { describe, expect, it } from 'vitest';
import { buildTopology, type TopologyWay } from '../topology/index.js';
import { Graph, dijkstra } from './index.js';

describe('B↔C 联调:buildTopology → Graph → dijkstra', () => {
  it('单向道路(oneway=yes)构建正向边并可正向寻路', () => {
    const nodes = new Map<number, [number, number]>([
      [1, [30.0, 114.0]],
      [2, [30.0, 114.1]],
      [3, [30.0, 114.2]],
    ]);
    const ways: TopologyWay[] = [
      {
        id: 100,
        highway: 'residential',
        tags: { highway: 'residential', oneway: 'yes' },
        nds: [1, 2, 3],
      },
    ];
    const { nodes: topoNodes, edges } = buildTopology(nodes, ways);
    const graph = new Graph(topoNodes, edges);

    expect(graph.edgeCount).toBe(2);
    expect(graph.outEdges(1).map((e) => e.to)).toEqual([2]);
    expect(graph.outEdges(2).map((e) => e.to)).toEqual([3]);
    const fwd = dijkstra(graph, 1, 3);
    expect(fwd.distance).toBeGreaterThan(0);
    expect(fwd.nodeIds).toEqual([1, 2, 3]);
    expect(dijkstra(graph, 3, 1).distance).toBe(Infinity);
  });

  it('反向道路(oneway=-1)只允许逆原始序列', () => {
    const nodes = new Map<number, [number, number]>([
      [1, [30.0, 114.0]],
      [2, [30.0, 114.1]],
    ]);
    const ways: TopologyWay[] = [
      {
        id: 200,
        highway: 'residential',
        tags: { highway: 'residential', oneway: '-1' },
        nds: [1, 2],
      },
    ];
    const { nodes: topoNodes, edges } = buildTopology(nodes, ways);
    const graph = new Graph(topoNodes, edges);
    expect(graph.edgeCount).toBe(1);
    expect(graph.outEdges(2).map((e) => e.to)).toEqual([1]);
    expect(graph.outEdges(1).length).toBe(0);
    expect(dijkstra(graph, 2, 1).distance).toBeGreaterThan(0);
    expect(dijkstra(graph, 1, 2).distance).toBe(Infinity);
  });

  it('无方向普通道路默认双向', () => {
    const nodes = new Map<number, [number, number]>([
      [1, [30.0, 114.0]],
      [2, [30.0, 114.1]],
    ]);
    const ways: TopologyWay[] = [
      {
        id: 300,
        highway: 'residential',
        tags: { highway: 'residential' },
        nds: [1, 2],
      },
    ];
    const { nodes: topoNodes, edges } = buildTopology(nodes, ways);
    const graph = new Graph(topoNodes, edges);
    expect(graph.edgeCount).toBe(2);
    expect(graph.outEdges(1).map((e) => e.to)).toEqual([2]);
    expect(graph.outEdges(2).map((e) => e.to)).toEqual([1]);
    expect(dijkstra(graph, 1, 2).distance).toBeGreaterThan(0);
    expect(dijkstra(graph, 2, 1).distance).toBeGreaterThan(0);
  });
});

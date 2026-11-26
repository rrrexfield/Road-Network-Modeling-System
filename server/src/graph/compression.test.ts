import { describe, expect, it } from 'vitest';
import type { RoadEdge, WayProperties } from '@gisalgo/shared';
import { CompressionWayIndex } from '../topology/index.js';
import { haversine } from './graph.js';
import {
  Graph,
  compressEdgeWeight,
  compressTopology,
  dijkstra,
  dijkstraWithTurnRestrictions,
  type CompressedEdge,
  type CompressionInput,
} from './index.js';

interface Spec {
  nodes: [id: number, lat: number, lon: number][];
  edges: [from: number, to: number, wayId: number][];
  ways: Map<number, string>;
  protected?: number[];
}

/** 用 C 的 CompressionWayIndex 作为真实属性边界查询，构造压缩输入。 */
function input(spec: Spec): CompressionInput {
  const nodes = new Map<number, [number, number]>();
  for (const [id, lat, lon] of spec.nodes) nodes.set(id, [lat, lon]);
  const edges: RoadEdge[] = spec.edges.map(([from, to, wayId], i) => ({ id: i, from, to, wayId }));
  const ways = new Map<number, WayProperties>();
  for (const [wid, h] of spec.ways) ways.set(wid, { id: wid, highway: h, tags: {} });
  return {
    nodes,
    edges,
    protectedNodes: new Set(spec.protected ?? []),
    wayBoundary: new CompressionWayIndex(ways),
  };
}

/** 一条同 way 的一向直行链 0→1→…→n，节点等 lon 间隔 0.001。 */
function chainSpec(n: number, wayId = 1, highway = 'residential'): Spec {
  const nodes: Spec['nodes'] = [];
  for (let i = 0; i <= n; i++) nodes.push([i, 0, i * 0.001]);
  const edges: Spec['edges'] = [];
  for (let i = 0; i < n; i++) edges.push([i, i + 1, wayId]);
  return { nodes, edges, ways: new Map([[wayId, highway]]) };
}

const distanceOf = (cg: ReturnType<typeof compressTopology>, e: CompressedEdge): number =>
  e.distance;

describe('度-2 节点压缩', () => {
  it('一向直行链合并为单条压缩边，距离 Σ 原边长度', () => {
    const cg = compressTopology(input(chainSpec(3)));
    expect(cg.stats).toMatchObject({
      originalNodeCount: 4,
      originalEdgeCount: 3,
      compressedNodeCount: 2,
      compressedEdgeCount: 1,
      contractedNodeCount: 2,
    });
    expect(cg.hasNode(1)).toBe(false);
    expect(cg.hasNode(2)).toBe(false);
    const e = cg.outEdges(0)[0]!;
    expect(e.from).toBe(0);
    expect(e.to).toBe(3);
    expect(e.originalEdgeIds).toEqual([0, 1, 2]);
    const expected =
      haversine([0, 0], [0, 0.001]) +
      haversine([0, 0.001], [0, 0.002]) +
      haversine([0, 0.002], [0, 0.003]);
    expect(e.distance).toBeCloseTo(expected, 6);
    expect(e.distance).toBeGreaterThan(0);
  });

  it('双向路中间点按去重邻居数判定（有向度 4 但邻居 2，仍压缩）', () => {
    // 0 ↔ 1 ↔ 2，way 相同；节点 1 有向度 = 4、去重邻居 = {0,2}。
    const cg = compressTopology(
      input({
        nodes: [
          [0, 0, 0],
          [1, 0, 0.001],
          [2, 0, 0.002],
        ],
        edges: [
          [0, 1, 1],
          [1, 0, 1],
          [1, 2, 1],
          [2, 1, 1],
        ],
        ways: new Map([[1, 'residential']]),
      }),
    );
    expect(cg.stats).toMatchObject({
      originalNodeCount: 3,
      originalEdgeCount: 4,
      compressedNodeCount: 2,
      compressedEdgeCount: 2,
      contractedNodeCount: 1,
    });
    expect(cg.hasNode(1)).toBe(false);
    const fwd = cg.outEdges(0)[0]!;
    const bwd = cg.outEdges(2)[0]!;
    expect(fwd.to).toBe(2);
    expect(fwd.originalEdgeIds).toEqual([0, 2]);
    expect(bwd.to).toBe(0);
    expect(bwd.originalEdgeIds).toEqual([3, 1]);
  });

  it('禁转 via 节点进入保留集，不压缩', () => {
    const spec = chainSpec(3);
    spec.protected = [1];
    const cg = compressTopology(input(spec));
    expect(cg.stats).toMatchObject({
      originalNodeCount: 4,
      compressedNodeCount: 3,
      compressedEdgeCount: 2,
      contractedNodeCount: 1,
    });
    expect(cg.hasNode(1)).toBe(true);
    expect(cg.hasNode(2)).toBe(false);
  });

  it('属性变化点（way 等级不同）保留链边界', () => {
    const cg = compressTopology(
      input({
        nodes: [
          [0, 0, 0],
          [1, 0, 0.001],
          [2, 0, 0.002],
        ],
        edges: [
          [0, 1, 10],
          [1, 2, 20],
        ],
        ways: new Map([
          [10, 'residential'],
          [20, 'primary'],
        ]),
      }),
    );
    expect(cg.hasNode(1)).toBe(true);
    expect(cg.stats.compressedNodeCount).toBe(3);
    expect(cg.stats.compressedEdgeCount).toBe(2);
  });

  it('方向模式变化点（双向↔单向分叉）保留', () => {
    const cg = compressTopology(
      input({
        nodes: [
          [0, 0, 0],
          [1, 0, 0.001],
          [2, 0, 0.002],
        ],
        edges: [
          [0, 1, 1],
          [1, 0, 1],
          [1, 2, 1],
        ],
        ways: new Map([[1, 'residential']]),
      }),
    );
    // 节点 1：入 {0}、出 {0,2}，非干净直通，保留。
    expect(cg.hasNode(1)).toBe(true);
    expect(cg.stats.compressedNodeCount).toBe(3);
    expect(cg.stats.compressedEdgeCount).toBe(3);
  });

  it('死端汇合节点（两条一向路都指向同一终点）保留', () => {
    const cg = compressTopology(
      input({
        nodes: [
          [0, 0, 0],
          [1, 0, 0.001],
          [2, 0, 0.0015],
        ],
        edges: [
          [0, 2, 1],
          [1, 2, 1],
        ],
        ways: new Map([[1, 'residential']]),
      }),
    );
    expect(cg.hasNode(2)).toBe(true);
    expect(cg.stats.compressedNodeCount).toBe(3);
    expect(cg.stats.compressedEdgeCount).toBe(2);
  });
});

describe('压缩路径还原与原图一致', () => {
  it('一向链 + 路口分叉：展开后与原图逐边一致', () => {
    const spec: Spec = {
      nodes: [
        [0, 0, 0],
        [1, 0, 0.001],
        [2, 0, 0.002],
        [3, 0, 0.003],
        [4, 0, 0.004],
        [5, 0, 0.004],
      ],
      // 0→1→2→3 链，3 是路口分叉到 4、5。
      edges: [
        [0, 1, 1],
        [1, 2, 1],
        [2, 3, 1],
        [3, 4, 1],
        [3, 5, 1],
      ],
      ways: new Map([[1, 'residential']]),
    };
    const graph = new Graph(
      new Map(spec.nodes.map(([id, lat, lon]) => [id, [lat, lon] as [number, number]])),
      input(spec).edges,
    );
    const cg = compressTopology(input(spec));

    expect(cg.hasNode(3)).toBe(true); // 路口保留
    expect(cg.hasNode(1)).toBe(false);

    const orig = dijkstra(graph, 0, 4);
    const comp = dijkstraWithTurnRestrictions(
      cg,
      0,
      4,
      undefined,
      (e) => (e as CompressedEdge).distance,
    );
    const expanded = cg.expandPath(comp.nodeIds, comp.edgeIds);

    // 距离：Graph 以 Float32 存坐标、压缩以原 float64 坐标算，相差约 1e-5 m，放宽到毫米级。
    expect(comp.distance).toBeCloseTo(orig.distance, 3);
    expect(expanded.nodeIds).toEqual(orig.nodeIds);
    expect(expanded.edgeIds).toEqual(orig.edgeIds);
    expect(expanded.nodeIds).toEqual([0, 1, 2, 3, 4]);
  });

  it('双向链路径还原一致', () => {
    const spec: Spec = {
      nodes: [
        [0, 0, 0],
        [1, 0, 0.001],
        [2, 0, 0.002],
      ],
      edges: [
        [0, 1, 1],
        [1, 0, 1],
        [1, 2, 1],
        [2, 1, 1],
      ],
      ways: new Map([[1, 'residential']]),
    };
    const graph = new Graph(
      new Map(spec.nodes.map(([id, lat, lon]) => [id, [lat, lon] as [number, number]])),
      input(spec).edges,
    );
    const cg = compressTopology(input(spec));

    const orig = dijkstra(graph, 0, 2);
    const comp = dijkstraWithTurnRestrictions(
      cg,
      0,
      2,
      undefined,
      (e) => (e as CompressedEdge).distance,
    );
    const expanded = cg.expandPath(comp.nodeIds, comp.edgeIds);

    expect(comp.distance).toBeCloseTo(orig.distance, 3);
    expect(expanded.nodeIds).toEqual([0, 1, 2]);
    expect(expanded.edgeIds).toEqual(orig.edgeIds);
  });
});

describe('权重累计口径', () => {
  it('压缩边距离 = Σ 原边 Haversine', () => {
    const cg = compressTopology(input(chainSpec(4)));
    const e = cg.outEdges(0)[0]!;
    const per = [0, 1, 2, 3].map((i) => haversine([0, i * 0.001], [0, (i + 1) * 0.001]));
    expect(distanceOf(cg, e)).toBeCloseTo(per.reduce((a, b) => a + b, 0), 6);
  });

  it('时间口径逐原边求和（compressEdgeWeight），不先平均', () => {
    const cg = compressTopology(input(chainSpec(3)));
    const e = cg.outEdges(0)[0]!;
    // 逐原边按 id 加权（模拟每条原边各自限速/耗时），与“先平均再乘总长”不同。
    const originalWeight = (oe: RoadEdge): number => (oe.id + 1) * 10;
    const compressedWeight = compressEdgeWeight(cg, originalWeight);
    const expected = e.originalEdgeIds.reduce((sum, id) => sum + (id + 1) * 10, 0);
    expect(compressedWeight(e)).toBe(expected);
  });
});

import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { Graph, createAdjacencyView, dijkstra, dijkstraWithTurnRestrictions } from './index.js';

/** 构造测试边；wayId 恒为 1，本测试只关心拓扑与边 id。 */
function roadEdge(id: number, from: number, to: number): RoadEdge {
  return { id, from, to, wayId: 1 };
}

/** 单位边权：每条边代价 1，便于断言精确的跳数与路径。 */
const unitWeight = (): number => 1;

/** 十字路口（中心 0，北 1 / 南 2 / 东 3 / 西 4），双向边。 */
function crossNodes(): Map<number, [number, number]> {
  return new Map<number, [number, number]>([
    [0, [0, 0]], // C 中心
    [1, [1, 0]], // N 北
    [2, [-1, 0]], // S 南
    [3, [0, 1]], // E 东
    [4, [0, -1]], // W 西
  ]);
}

/** 十字路口的 8 条有向边：0/1=N↔C，2/3=S↔C，4/5=E↔C，6/7=W↔C。 */
function crossEdges(): RoadEdge[] {
  return [
    roadEdge(0, 1, 0),
    roadEdge(1, 0, 1),
    roadEdge(2, 2, 0),
    roadEdge(3, 0, 2),
    roadEdge(4, 3, 0),
    roadEdge(5, 0, 3),
    roadEdge(6, 4, 0),
    roadEdge(7, 0, 4),
  ];
}

/** 禁“从 N 驶入中心后左转去 E”：via=0，from=0（N→C），to=5（C→E）。 */
const forbidLeftFromNorth = (via: number, from: number, to: number): boolean =>
  via === 0 && from === 0 && to === 5;

/** 判断边序列中是否存在 a 紧邻 b 的相邻对。 */
function hasAdjacentPair(edges: number[], a: number, b: number): boolean {
  for (let i = 0; i + 1 < edges.length; i++) {
    if (edges[i] === a && edges[i + 1] === b) return true;
  }
  return false;
}

describe('dijkstraWithTurnRestrictions', () => {
  it('不提供禁转时与普通 dijkstra 结果一致（兼容无限制模式）', () => {
    const nodes = new Map<number, [number, number]>([
      [1, [30.0, 114.0]],
      [2, [30.0, 114.1]],
      [3, [30.0, 114.2]],
      [4, [30.0, 114.3]],
    ]);
    const g = new Graph(nodes, [roadEdge(0, 1, 2), roadEdge(1, 2, 3), roadEdge(2, 3, 4)]);

    const plain = dijkstra(g, 1, 4, unitWeight);
    const unrestricted = dijkstraWithTurnRestrictions(g, 1, 4, undefined, unitWeight);
    const allowAll = dijkstraWithTurnRestrictions(g, 1, 4, () => false, unitWeight);

    expect(plain).toEqual({ distance: 3, nodeIds: [1, 2, 3, 4], edgeIds: [0, 1, 2] });
    expect(unrestricted).toEqual(plain);
    expect(allowAll).toEqual(plain);
  });

  it('禁左转后该转向不可用，同路口其他转向不受影响', () => {
    const g = new Graph(crossNodes(), crossEdges());

    // 直行 N→C→S 与右转 N→C→W 均不受影响
    expect(dijkstraWithTurnRestrictions(g, 1, 2, forbidLeftFromNorth, unitWeight)).toEqual({
      distance: 2,
      nodeIds: [1, 0, 2],
      edgeIds: [0, 3],
    });
    expect(dijkstraWithTurnRestrictions(g, 1, 4, forbidLeftFromNorth, unitWeight)).toEqual({
      distance: 2,
      nodeIds: [1, 0, 4],
      edgeIds: [0, 7],
    });

    // 左转 N→C→E 被禁，只能绕行（经西臂掉头回来，代价 4 > 直连 2），
    // 且被禁的 N→C→E 边对不再相邻出现。
    const detour = dijkstraWithTurnRestrictions(g, 1, 3, forbidLeftFromNorth, unitWeight);
    expect(detour.distance).toBe(4);
    expect(detour.nodeIds[0]).toBe(1);
    expect(detour.nodeIds[detour.nodeIds.length - 1]).toBe(3);
    expect(hasAdjacentPair(detour.edgeIds, 0, 5)).toBe(false);
  });

  it('同一路口、不同入边的禁转互不影响（节点级标签做不到）', () => {
    // A→C→D 与 B→C→D 共用一个路口 C 与同一条出边 C→D；
    // 仅禁止“从 A 驶入”的转向，从 B 驶入不受影响。
    const nodes = new Map<number, [number, number]>([
      [0, [0, 0]], // C 中心
      [1, [1, 0]], // A
      [2, [0, 1]], // B
      [3, [-1, 0]], // D
    ]);
    const g = new Graph(nodes, [roadEdge(0, 1, 0), roadEdge(1, 2, 0), roadEdge(2, 0, 3)]);

    const forbidFromA = (via: number, from: number, to: number): boolean =>
      via === 0 && from === 0 && to === 2;

    // A→D：唯一路径 A→C→D 被禁 → 不可达
    expect(dijkstraWithTurnRestrictions(g, 1, 3, forbidFromA, unitWeight)).toEqual({
      distance: Infinity,
      nodeIds: [],
      edgeIds: [],
    });
    // B→D：从 B 驶入 C 不受 A 的禁转影响 → 直达
    expect(dijkstraWithTurnRestrictions(g, 2, 3, forbidFromA, unitWeight)).toEqual({
      distance: 2,
      nodeIds: [2, 0, 3],
      edgeIds: [1, 2],
    });
  });

  it('禁转使路径改道且代价变长', () => {
    // 十字路口外加一条 N→NE1→NE2→E 的绕行支路。
    const nodes = new Map<number, [number, number]>([
      [0, [0, 0]],
      [1, [1, 0]], // N
      [2, [-1, 0]], // S
      [3, [0, 1]], // E
      [4, [0, -1]], // W
      [5, [2, 0]], // NE1
      [6, [2, 1]], // NE2
    ]);
    const edges: RoadEdge[] = [
      ...crossEdges(),
      roadEdge(8, 1, 5),
      roadEdge(9, 5, 1),
      roadEdge(10, 5, 6),
      roadEdge(11, 6, 5),
      roadEdge(12, 6, 3),
      roadEdge(13, 3, 6),
    ];
    const g = new Graph(nodes, edges);

    const free = dijkstraWithTurnRestrictions(g, 1, 3, undefined, unitWeight);
    expect(free).toEqual({ distance: 2, nodeIds: [1, 0, 3], edgeIds: [0, 5] });

    const restricted = dijkstraWithTurnRestrictions(g, 1, 3, forbidLeftFromNorth, unitWeight);
    expect(restricted).toEqual({ distance: 3, nodeIds: [1, 5, 6, 3], edgeIds: [8, 10, 12] });
    expect(restricted.distance).toBeGreaterThan(free.distance);
  });

  it('缺起点/终点或同点按既有 PathResult 约定返回', () => {
    const g = new Graph(crossNodes(), crossEdges());
    expect(dijkstraWithTurnRestrictions(g, 1, 999, forbidLeftFromNorth, unitWeight)).toEqual({
      distance: Infinity,
      nodeIds: [],
      edgeIds: [],
    });
    expect(dijkstraWithTurnRestrictions(g, 1, 1, forbidLeftFromNorth, unitWeight)).toEqual({
      distance: 0,
      nodeIds: [1],
      edgeIds: [],
    });
  });

  it('createAdjacencyView 提供与 Graph 一致的邻接与边查找，并支持禁转搜索', () => {
    const view = createAdjacencyView(crossNodes(), crossEdges());
    const graph = new Graph(crossNodes(), crossEdges());

    expect(view.hasNode(0)).toBe(true);
    expect(view.hasNode(999)).toBe(false);
    expect(
      view
        .outEdges(0)
        .map((e) => e.id)
        .sort(),
    ).toEqual(
      graph
        .outEdges(0)
        .map((e) => e.id)
        .sort(),
    );
    expect(view.edge(5)).toEqual(graph.edge(5));
    expect(dijkstraWithTurnRestrictions(view, 1, 2, forbidLeftFromNorth, unitWeight)).toEqual(
      dijkstraWithTurnRestrictions(graph, 1, 2, forbidLeftFromNorth, unitWeight),
    );
  });
});

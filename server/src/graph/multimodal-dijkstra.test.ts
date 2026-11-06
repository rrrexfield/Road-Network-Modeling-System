import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import {
  Graph,
  dijkstra,
  multimodalDijkstra,
  type EdgeWeightFn,
  type ModalLayer,
  type TransferLink,
} from './index.js';

/** 构造测试边；wayId 恒为 1，本测试只关心拓扑与边 id。 */
function roadEdge(id: number, from: number, to: number): RoadEdge {
  return { id, from, to, wayId: 1 };
}

/** 单位边权：每条边代价 1，便于断言精确的跳数与路径。 */
const unitWeight = (): number => 1;

/** 按边 id 指定权重的权重函数；未列出的边权重为 1。 */
function weightById(weights: Record<number, number>): EdgeWeightFn {
  return (e) => weights[e.id] ?? 1;
}

/** 坐标按 id 均匀铺开，满足 Graph 对坐标有限性的要求即可。 */
function coords(ids: readonly number[]): Map<number, [number, number]> {
  return new Map(ids.map((id, i) => [id, [30 + i * 0.001, 114 + i * 0.001]]));
}

// ---------------------------------------------------------------- 单模态夹具

const singleNodes = coords([1, 2, 3, 4]);
const singleEdges = [roadEdge(0, 1, 2), roadEdge(1, 2, 3), roadEdge(2, 3, 4)];
const singleGraph = new Graph(singleNodes, singleEdges);
const singleLayer: ModalLayer = { mode: 'car', graph: singleGraph, weight: unitWeight };

// ------------------------------------------------------------ 两层（车 → 步行）

/** 车行层：1（起点）→ 2（换乘点）。 */
const carGraph = new Graph(coords([1, 2]), [roadEdge(0, 1, 2)]);
/** 步行层：10（换乘入口）→ 11（终点）。 */
const walkGraph = new Graph(coords([10, 11]), [roadEdge(1, 10, 11)]);

const carLayer: ModalLayer = { mode: 'car', graph: carGraph, weight: weightById({ 0: 5 }) };
const walkLayer: ModalLayer = { mode: 'walk', graph: walkGraph, weight: weightById({ 1: 7 }) };

/** 唯一可用的换乘：车行节点 2 → 步行节点 10，罚时 60 秒。 */
const mainLink: TransferLink = {
  fromMode: 'car',
  fromNodeId: 2,
  toMode: 'walk',
  toNodeId: 10,
  penaltySeconds: 60,
  transferPointId: 100,
};

/** 模态不匹配的链接（非相邻层）必须被忽略。 */
const ignoredLink: TransferLink = {
  fromMode: 'bus',
  fromNodeId: 2,
  toMode: 'bike',
  toNodeId: 10,
  penaltySeconds: 5,
  transferPointId: 999,
};

// -------------------------------------------------- 两层多候选换乘点（DP 夹具）

/** 车行层：1 → 2（近的换乘点）、1 → 3（远的换乘点）。 */
const dpCarGraph = new Graph(coords([1, 2, 3]), [roadEdge(0, 1, 2), roadEdge(1, 1, 3)]);
/** 步行层：20 → 22（后续很长的路）、21 → 22（后续很短的路）。 */
const dpWalkGraph = new Graph(coords([20, 21, 22]), [roadEdge(2, 20, 22), roadEdge(3, 21, 22)]);

const dpCarLayer: ModalLayer = {
  mode: 'car',
  graph: dpCarGraph,
  weight: weightById({ 0: 1, 1: 10 }),
};
const dpWalkLayer: ModalLayer = {
  mode: 'walk',
  graph: dpWalkGraph,
  weight: weightById({ 2: 100, 3: 2 }),
};

/** 近但后续长：总代价 1 + 100 = 101；远但后续短：总代价 10 + 2 = 12。 */
const dpLinks: TransferLink[] = [
  {
    fromMode: 'car',
    fromNodeId: 2,
    toMode: 'walk',
    toNodeId: 20,
    penaltySeconds: 0,
    transferPointId: 100,
  },
  {
    fromMode: 'car',
    fromNodeId: 3,
    toMode: 'walk',
    toNodeId: 21,
    penaltySeconds: 0,
    transferPointId: 200,
  },
];

// -------------------------------------------------------------- 禁转夹具（层内）

/** 车行层：1 → 2 → 3 直达，另有 1 → 4 → 5 → 3 绕行支路。 */
const turnCarGraph = new Graph(coords([1, 2, 3, 4, 5]), [
  roadEdge(0, 1, 2),
  roadEdge(1, 2, 3),
  roadEdge(2, 1, 4),
  roadEdge(3, 4, 5),
  roadEdge(4, 5, 3),
]);
const turnCarLayer: ModalLayer = {
  mode: 'car',
  graph: turnCarGraph,
  weight: unitWeight,
};
const turnWalkLayer: ModalLayer = {
  mode: 'walk',
  graph: new Graph(coords([10, 11]), [roadEdge(5, 10, 11)]),
  weight: unitWeight,
};
const turnLink: TransferLink = {
  fromMode: 'car',
  fromNodeId: 3,
  toMode: 'walk',
  toNodeId: 10,
  penaltySeconds: 0,
  transferPointId: 300,
};
/** 禁“经 1 → 2 驶入 2 后转入 2 → 3”。 */
const forbidStraight = (via: number, from: number, to: number): boolean =>
  via === 2 && from === 0 && to === 1;

describe('multimodalDijkstra', () => {
  it('单模态：与既有 dijkstra 的距离、节点序列一致', () => {
    const plain = dijkstra(singleGraph, 1, 4, unitWeight);
    const r = multimodalDijkstra([singleLayer], [], 1, 4);

    expect(plain).toEqual({ distance: 3, nodeIds: [1, 2, 3, 4], edgeIds: [0, 1, 2] });
    expect(r.cost).toBe(plain.distance);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toEqual({
      mode: 'car',
      cost: 3,
      nodeIds: [1, 2, 3, 4],
      edgeIds: [0, 1, 2],
    });
    expect(r.segments[0]!.nodeIds).toEqual(plain.nodeIds);
    expect(r.segments[0]!.edgeIds).toEqual(plain.edgeIds);
    expect(r.transfers).toEqual([]);
    expect(r.segments[0]!.fromTransferPoint).toBeUndefined();
    expect(r.segments[0]!.toTransferPoint).toBeUndefined();
    // 回溯代价自洽：段内代价 === 沿途边权之和。
    expect(r.segments[0]!.cost).toBe(r.segments[0]!.edgeIds.length);
  });

  it('多边段：段内代价 === 沿途边权之和（回溯与 dist 自洽）', () => {
    const weighted: ModalLayer = {
      mode: 'car',
      graph: singleGraph,
      weight: weightById({ 0: 2, 1: 3, 2: 5 }),
    };
    const r = multimodalDijkstra([weighted], [], 1, 4);

    expect(r.cost).toBe(2 + 3 + 5);
    expect(r.segments[0]!.cost).toBe(2 + 3 + 5);
    expect(r.segments[0]!.edgeIds).toEqual([0, 1, 2]);
    expect(dijkstra(singleGraph, 1, 4, weighted.weight).distance).toBe(2 + 3 + 5);
  });

  it('两层但没有换乘链接 → 不可达', () => {
    const r = multimodalDijkstra([carLayer, walkLayer], [], 1, 11);
    expect(r.cost).toBe(Infinity);
    expect(r.segments).toEqual([]);
    expect(r.transfers).toEqual([]);
  });

  it('两层有换乘链接：总代价 === 段1 + 罚时 + 段2，分段与换乘记录完整', () => {
    const r = multimodalDijkstra([carLayer, walkLayer], [mainLink], 1, 11, {
      metric: 'time',
    });

    expect(r.cost).toBe(5 + 60 + 7);
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]).toEqual({
      mode: 'car',
      cost: 5,
      nodeIds: [1, 2],
      edgeIds: [0],
      toTransferPoint: 100,
    });
    expect(r.segments[1]).toEqual({
      mode: 'walk',
      cost: 7,
      nodeIds: [10, 11],
      edgeIds: [1],
      fromTransferPoint: 100,
    });
    expect(r.segments[0]!.fromTransferPoint).toBeUndefined();
    expect(r.segments[1]!.toTransferPoint).toBeUndefined();
    expect(r.transfers).toEqual([
      {
        transferPointId: 100,
        fromMode: 'car',
        toMode: 'walk',
        fromNodeId: 2,
        toNodeId: 10,
        penaltySeconds: 60,
      },
    ]);
    // 段内代价不含换乘罚时。
    expect(r.segments[0]!.cost + r.segments[1]!.cost).toBe(12);
  });

  it("metric='distance'：换乘罚时不计入代价，但分段与换乘记录仍然成立", () => {
    const r = multimodalDijkstra([carLayer, walkLayer], [mainLink], 1, 11, {
      metric: 'distance',
    });

    expect(r.cost).toBe(5 + 7);
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]!.cost).toBe(5);
    expect(r.segments[1]!.cost).toBe(7);
    expect(r.segments[0]!.toTransferPoint).toBe(100);
    expect(r.segments[1]!.fromTransferPoint).toBe(100);
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0]!.transferPointId).toBe(100);
    expect(r.transfers[0]!.penaltySeconds).toBe(60);
  });

  it('非相邻层的换乘链接被忽略', () => {
    const r = multimodalDijkstra([carLayer, walkLayer], [mainLink, ignoredLink], 1, 11, {
      metric: 'time',
    });
    expect(r.cost).toBe(5 + 60 + 7);
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0]!.transferPointId).toBe(100);
  });

  it('DP 最优性：多个候选换乘点时取总代价全局最小者（不是贪心第一个）', () => {
    const r = multimodalDijkstra([dpCarLayer, dpWalkLayer], dpLinks, 1, 22, {
      metric: 'time',
    });

    // 近点方案 1 + 100 = 101，远点方案 10 + 2 = 12 → 必须取远点。
    expect(r.cost).toBe(12);
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0]!.transferPointId).toBe(200);
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]!.nodeIds).toEqual([1, 3]);
    expect(r.segments[0]!.cost).toBe(10);
    expect(r.segments[0]!.toTransferPoint).toBe(200);
    expect(r.segments[1]!.nodeIds).toEqual([21, 22]);
    expect(r.segments[1]!.cost).toBe(2);
    expect(r.segments[1]!.fromTransferPoint).toBe(200);
  });

  it('层内禁转生效：被禁边对后绕行且代价变长', () => {
    const free = multimodalDijkstra([turnCarLayer, turnWalkLayer], [turnLink], 1, 11);
    expect(free.cost).toBe(3);
    expect(free.segments[0]!.nodeIds).toEqual([1, 2, 3]);

    const restricted = multimodalDijkstra(
      [{ ...turnCarLayer, isTurnForbidden: forbidStraight }, turnWalkLayer],
      [turnLink],
      1,
      11,
    );
    expect(restricted.cost).toBe(4);
    expect(restricted.cost).toBeGreaterThan(free.cost);
    expect(restricted.segments[0]!.nodeIds).toEqual([1, 4, 5, 3]);
    expect(restricted.segments[0]!.edgeIds).toEqual([2, 3, 4]);
    expect(restricted.segments[0]!.cost).toBe(3);
  });

  it('终点所在层不可达 → Infinity', () => {
    const emptyWalk: ModalLayer = {
      mode: 'walk',
      graph: new Graph(coords([10, 11]), []),
      weight: unitWeight,
    };
    const r = multimodalDijkstra([carLayer, emptyWalk], [mainLink], 1, 11);
    expect(r.cost).toBe(Infinity);
    expect(r.segments).toEqual([]);
    expect(r.transfers).toEqual([]);
  });

  it('非法入参统一抛错', () => {
    expect(() => multimodalDijkstra([], [], 1, 4)).toThrow(/layers 不能为空/);
    expect(() => multimodalDijkstra([singleLayer], [], 999, 4)).toThrow(/起点节点/);
    expect(() => multimodalDijkstra([singleLayer], [], 1, 999)).toThrow(/终点节点/);
    expect(() =>
      multimodalDijkstra([carLayer, walkLayer], [{ ...mainLink, penaltySeconds: -1 }], 1, 11),
    ).toThrow(/penaltySeconds 非法/);
    expect(() =>
      multimodalDijkstra(
        [carLayer, walkLayer],
        [{ ...mainLink, penaltySeconds: Number.POSITIVE_INFINITY }],
        1,
        11,
      ),
    ).toThrow(/penaltySeconds 非法/);
  });
});

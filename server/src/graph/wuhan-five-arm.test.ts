import { describe, expect, it } from 'vitest';
import raw from '../io/fixtures/wuhan-five-arm.json';
import { buildTopology, IntersectionTurnIndex, type TopologyWay } from '../topology/index.js';
import { Graph, dijkstraWithTurnRestrictions } from './index.js';

/**
 * 武汉五路口固定用例（B 侧：禁转驱动的搜索绕行）。
 *
 * 与 C 的 `server/src/topology/wuhan-five-arm.test.ts` 共用同一份夹具
 * （`server/src/io/fixtures/wuhan-five-arm.json`，见 docs/plans/c-wuhan-five-arm-fixture.md）。
 * C 验证了构边、稀疏表与转向枚举，这里验证**搜索真正尊重禁转且不错误剪枝**。
 *
 * 固定“人工禁左”：从 1881989364 驶入中心 1881981626 后禁止左转去 1881981633。
 * 该规则是人工演示规则，不声称现实道路或 OSM 数据禁止左转。
 */

/** 夹具中的中心路口节点。 */
const VIA_NODE = raw.viaNode as number;

/** 判断边序列中是否存在 a 紧邻 b 的相邻对（用于断言被禁转向未被使用）。 */
function hasAdjacentPair(edges: number[], a: number, b: number): boolean {
  for (let i = 0; i + 1 < edges.length; i++) {
    if (edges[i] === a && edges[i + 1] === b) return true;
  }
  return false;
}

function fixture() {
  const nodes = new Map<number, [number, number]>(raw.nodes.map((n) => [n[0]!, [n[1]!, n[2]!]]));
  const topology = buildTopology(nodes, raw.ways as TopologyWay[]);
  return {
    topology,
    graph: new Graph(topology.nodes, topology.edges),
    index: new IntersectionTurnIndex(topology.nodes, topology.edges),
  };
}

describe('武汉五路口固定用例：禁转驱动的绕行', () => {
  it('禁左转后路径绕行且中心节点访问两次（带入边状态，不错误剪枝）', () => {
    const { topology, graph, index } = fixture();

    // 固定左转的入边 / 出边：1881989364 → 中心 → 1881981633（按端点动态查边，不硬编码 edgeId）。
    const incoming = topology.edges.find((e) => e.from === 1881989364 && e.to === VIA_NODE);
    const outgoing = topology.edges.find((e) => e.from === VIA_NODE && e.to === 1881981633);
    expect(incoming).toBeDefined();
    expect(outgoing).toBeDefined();

    // 无禁转：直连 2 边。
    const free = dijkstraWithTurnRestrictions(graph, 1881989364, 1881981633);
    expect(free.nodeIds).toEqual([1881989364, VIA_NODE, 1881981633]);

    // 设置与 C 一致的固定人工禁左。
    index.restrictions.replace(VIA_NODE, {
      forbidden: [{ fromEdge: incoming!.id, toEdge: outgoing!.id }],
    });
    const isForbidden = (via: number, from: number, to: number): boolean =>
      index.restrictions.isForbidden(via, from, to);

    const restricted = dijkstraWithTurnRestrictions(graph, 1881989364, 1881981633, isForbidden);

    // 绕行：驶出 1881986250 臂再掉头回来，经另一入边驶入中心后左转，
    // 中心节点因此被访问两次——证明搜索状态带入了入边维度，未被错误剪枝。
    expect(restricted.nodeIds).toEqual([1881989364, VIA_NODE, 1881986250, VIA_NODE, 1881981633]);
    expect(restricted.distance).toBeGreaterThan(free.distance);
    expect(hasAdjacentPair(restricted.edgeIds, incoming!.id, outgoing!.id)).toBe(false);
  });
});

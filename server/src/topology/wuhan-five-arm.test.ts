import { describe, expect, it } from 'vitest';
import raw from '../io/fixtures/wuhan-five-arm.json';
import { buildTopology, IntersectionTurnIndex, type TopologyWay } from './index';

function fixture() {
  const nodes = new Map<number, [number, number]>(raw.nodes.map((n) => [n[0]!, [n[1]!, n[2]!]]));
  const topology = buildTopology(nodes, raw.ways as TopologyWay[]);
  return { topology, index: new IntersectionTurnIndex(topology.nodes, topology.edges) };
}

describe('武汉原始数据五分支节点固定用例', () => {
  it('保留真实节点、五个相邻方向和原始单行标签', () => {
    const { topology, index } = fixture();
    expect(raw.viaNode).toBe(1881981626);
    expect(raw.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(topology.issues).toEqual([]);
    expect(topology.nodes.size).toBe(6);
    expect(topology.edges).toHaveLength(7);
    const neighbors = new Set(topology.edges.map((e) => (e.from === raw.viaNode ? e.to : e.from)));
    expect(neighbors.size).toBe(5);
    const intersection = index.getTurns(raw.viaNode);
    expect(intersection.position).toEqual([114.2977284, 30.5953319]);
    // 真实单行规则：4条入边×3条出边，而非合成双向五路口的25项。
    expect(intersection.turns).toHaveLength(12);
    expect(intersection.turns.some((t) => t.turnKind === 'ambiguous')).toBe(true);
  });

  it('固定手动禁转仅作用于目标入口/出口，不冒充 OSM 禁转记录', () => {
    const { topology, index } = fixture();
    const incoming = topology.edges.find((e) => e.from === 1881989364 && e.to === raw.viaNode)!;
    const outgoing = topology.edges.find((e) => e.from === raw.viaNode && e.to === 1881981633)!;
    const target = index
      .getTurns(raw.viaNode)
      .turns.find((t) => t.fromEdge === incoming.id && t.toEdge === outgoing.id)!;
    expect(target.turnKind).toBe('left');
    expect(target.forbidden).toBe(false);
    index.restrictions.replace(raw.viaNode, {
      forbidden: [{ fromEdge: incoming.id, toEdge: outgoing.id }],
    });
    const updated = index.getTurns(raw.viaNode).turns;
    expect(updated.filter((t) => t.forbidden)).toHaveLength(1);
    expect(
      updated.find((t) => t.fromEdge === incoming.id && t.toEdge === outgoing.id),
    ).toMatchObject({ forbidden: true, fromOsm: false });
    expect(updated.filter((t) => t.fromEdge !== incoming.id).every((t) => !t.forbidden)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { TravelMode } from '@gisalgo/shared';
import { Graph, dijkstra } from '../graph/index.js';
import { buildModalTopology, IntersectionTurnIndex, type NodeTags } from './index.js';
import scenario from './fixtures/node-access-scenarios.json';
import gate from './fixtures/wuhan-permit-gate.json';

const nodes = new Map<number, [number, number]>(scenario.nodes.map((n) => [n[0]!, [n[1]!, n[2]!]]));
const tags = (t: Record<string, string | undefined>, id = 2): NodeTags =>
  new Map([[id, Object.entries(t).flatMap(([k, v]) => (v === undefined ? [] : [{ k, v }]))]]);
const build = (input?: NodeTags, detour = false) =>
  buildModalTopology(
    nodes,
    detour ? [scenario.directWay, scenario.detourWay] : [scenario.directWay],
    'walk',
    input,
  );
const path = (t: ReturnType<typeof build>['topology'], from = 1, to = 3) =>
  dijkstra(new Graph(t.nodes, t.edges), from, to);

describe('节点准入过滤', () => {
  it.each(scenario.cases)('$id：$mode节点权限', (c) => {
    const result = buildModalTopology(
      nodes,
      [scenario.directWay],
      c.mode as TravelMode,
      tags(c.tags),
    );
    expect(result.nodeAccess.checked).toBe(true);
    if (c.proposed === 'allow') {
      expect(result.nodeAccess.excludedNodes).toEqual([]);
      expect(result.topology.edges).toHaveLength(4);
    } else {
      expect(result.nodeAccess.excludedNodes).toHaveLength(1);
      expect(result.nodeAccess.excludedNodes[0]?.nodeId).toBe(2);
      expect(result.nodeAccess.excludedNodes[0]?.reason).toBeTruthy();
      expect(result.topology.edges).toEqual([]);
    }
  });
  it('无nodeTags兼容旧调用，空的完整标签表与未检查明确区分', () => {
    const unchecked = build();
    const checked = build(new Map());
    expect(unchecked.nodeAccess.checked).toBe(false);
    expect(checked.nodeAccess.checked).toBe(true);
    expect(checked.topology.edges).toEqual(unchecked.topology.edges);
  });
  it('受限中间节点不可穿越，不跨缺口补边，原始数据保持不变', () => {
    const before = JSON.stringify(scenario);
    const input = tags({ foot: 'permit' });
    const result = build(input);
    expect(result.nodeAccess.excludedNodes).toEqual([
      { nodeId: 2, reason: 'node-permit-required' },
    ]);
    expect(result.nodeAccess.excludedEdgeCount).toBe(4);
    expect(result.topology.nodes.size).toBe(0);
    expect(path(result.topology).distance).toBe(Infinity);
    expect(JSON.stringify(scenario)).toBe(before);
    expect(input.get(2)).toEqual([{ k: 'foot', v: 'permit' }]);
  });
  it('实际绕行保持方向、边ID及道路原始标签，反向无路不补连接', () => {
    const original = build(undefined, true);
    const result = build(tags({ foot: 'no' }), true);
    expect(path(result.topology).nodeIds).toEqual([1, 4, 3]);
    expect(path(result.topology).distance).toBeGreaterThan(path(original.topology).distance);
    expect(path(result.topology, 3, 1).distance).toBe(Infinity);
    expect(result.topology.edges).toEqual(original.topology.edges.filter((e) => e.wayId === 101));
    expect(result.topology.ways.get(101)?.tags).toEqual(scenario.detourWay.tags);
  });
  it('起终点受限时不可达，不将隔离节点留作吸附目标', () => {
    for (const id of [1, 3]) {
      const result = build(tags({ foot: 'no' }, id), true);
      expect(result.topology.nodes.has(id)).toBe(false);
      expect(path(result.topology).distance).toBe(Infinity);
    }
  });
  it('路口索引只枚举剩余模式边，过滤节点的旧边不再可编辑', () => {
    const way = { id: 102, highway: 'residential', nds: [2, 4], tags: {} };
    const result = buildModalTopology(
      nodes,
      [scenario.directWay, way],
      'walk',
      tags({ foot: 'no' }, 3),
    );
    const turns = new IntersectionTurnIndex(result.topology.nodes, result.topology.edges).getTurns(
      2,
    );
    expect(result.topology.edges.every((e) => e.from !== 3 && e.to !== 3)).toBe(true);
    expect(turns.turns.every((t) => t.fromWayId === 100 || t.fromWayId === 102)).toBe(true);
    expect(turns.turns).toHaveLength(4);
  });
  it('原始扬波门片段提供标签后阻断permit，旧调用仍明确标为未检查', () => {
    const coordinates = new Map<number, [number, number]>(
      gate.nodes.map((n) => [n.id, [n.lat, n.lon]]),
    );
    const input: NodeTags = new Map(gate.nodes.map((n) => [n.id, n.tags]));
    const result = buildModalTopology(coordinates, gate.ways, 'walk', input);
    expect(result.nodeAccess.excludedNodes).toContainEqual({
      nodeId: 1358787382,
      reason: 'node-permit-required',
    });
    expect(result.topology.edges).toEqual([]);
    expect(
      dijkstra(new Graph(result.topology.nodes, result.topology.edges), 13565585882, 1358787402)
        .distance,
    ).toBe(Infinity);
    const old = buildModalTopology(coordinates, gate.ways, 'walk');
    expect(old.nodeAccess.checked).toBe(false);
    expect(old.topology.edges.length).toBeGreaterThan(0);
  });
  it('方向权限与无许可的屏障明确诊断，图外标签不制造排除统计', () => {
    const r = build(tags({ 'foot:forward': 'yes' }));
    expect(r.nodeAccess.excludedNodes[0]?.reason).toBe('directional-node-access');
    expect(build(tags({ barrier: 'gate' })).nodeAccess.excludedNodes[0]?.reason).toContain(
      'unresolved',
    );
    expect(build(tags({ foot: 'no' }, 999)).nodeAccess.excludedNodes).toEqual([]);
    expect(
      build(tags({ barrier: 'no', 'barrier:conditional': 'gate @ (Mo-Fr)' })).nodeAccess
        .excludedNodes[0]?.reason,
    ).toBe('conditional-node-barrier');
  });
});

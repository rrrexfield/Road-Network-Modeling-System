import { describe, expect, it } from 'vitest';
import gate from './fixtures/wuhan-permit-gate.json';
import scenarios from './fixtures/node-access-scenarios.json';
import { buildModalTopology } from './index.js';
import { Graph, dijkstra } from '../graph/index.js';

describe('节点准入修复前的输入与路径基线（不代表权限修复已通过）', () => {
  it('武汉原始闸门片段保留许可标签，并复现未传节点标签时的穿越路径', () => {
    const node = gate.nodes.find((n) => n.id === gate.gateNodeId)!;
    const tags = Object.fromEntries(node.tags.map((t) => [t.k, t.v]));
    expect(tags).toMatchObject({
      name: '扬波门',
      access: 'permit',
      foot: 'permit',
      barrier: 'gate',
    });
    expect(gate.sourceSha256).toBe(
      '0d23735b19f5d7f311b7f2c5f243620860970fbb86f9e4853d52b6a904214a3d',
    );
    const nodes = new Map<number, [number, number]>(gate.nodes.map((n) => [n.id, [n.lat, n.lon]]));
    const topology = buildModalTopology(nodes, gate.ways, 'walk').topology;
    const path = dijkstra(new Graph(topology.nodes, topology.edges), 13565585882, 1358787402);
    expect(path.nodeIds).toEqual([13565585882, 1358787382, 1358787402]);
    expect(path.distance).toBeGreaterThan(0);
    expect(path.distance).toBeLessThan(50);
    expect(topology.issues).toEqual([]);
    expect(gate.ways[0]!.sourceRange).toEqual({
      start: 37,
      endExclusive: 40,
      originalNodeCount: 40,
    });
    // 当前三参数调用不知道nodeTags，以上仅复现缺口，不断言公众通行成立。
  });

  it('合成夹具的短路与单向绕行均沿实际节点段，反向绕行确实不可达', () => {
    const nodes = new Map<number, [number, number]>(
      scenarios.nodes.map((n) => [n[0]!, [n[1]!, n[2]!]]),
    );
    const full = buildModalTopology(
      nodes,
      [scenarios.directWay, scenarios.detourWay],
      'walk',
    ).topology;
    const fullPath = dijkstra(
      new Graph(full.nodes, full.edges),
      scenarios.source,
      scenarios.target,
    );
    expect(fullPath.nodeIds).toEqual(scenarios.baselineExpectedPath);
    // 单独的绕行图只验证将来回归所用路径基准，不模拟或实现权限过滤。
    const detour = buildModalTopology(nodes, [scenarios.detourWay], 'walk').topology;
    const graph = new Graph(detour.nodes, detour.edges);
    const path = dijkstra(graph, scenarios.source, scenarios.target);
    expect(path.nodeIds).toEqual(scenarios.detourExpectedPath);
    expect(path.distance).toBeGreaterThan(fullPath.distance);
    expect(dijkstra(graph, scenarios.target, scenarios.source).distance).toBe(Infinity);
  });
});

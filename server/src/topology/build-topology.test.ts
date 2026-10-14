import { describe, expect, it } from 'vitest';
import { buildTopology, type TopologyWay } from './index';

const nodes = new Map<number, [number, number]>([
  [1, [30, 114]],
  [2, [30, 115]],
  [3, [29, 114.5]],
  [4, [31, 114.5]],
  [5, [30, 114.5]],
  [6, [30, 114.5]],
]);
function way(id: number, nds: number[], tags: Record<string, string> = {}): TopologyWay {
  return { id, nds, highway: 'residential', tags };
}
function pairs(result: ReturnType<typeof buildTopology>): number[][] {
  return result.edges.map(({ from, to }) => [from, to]);
}

describe('buildTopology', () => {
  it.each(['bridge', 'tunnel'])('%s 与地面路几何相交时不新增路口', (structure) => {
    const result = buildTopology(nodes, [
      way(10, [1, 2], { [structure]: 'yes', layer: structure === 'bridge' ? '1' : '-1' }),
      way(20, [3, 4]),
    ]);
    expect(pairs(result)).toEqual([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
    ]);
    expect([...result.nodes.keys()].sort()).toEqual([1, 2, 3, 4]);
    expect(result.issues).toEqual([]);
  });

  it('交叉点坐标重合但节点 ID 不同时仍不相连', () => {
    const result = buildTopology(nodes, [
      way(10, [1, 5, 2], { bridge: 'yes', layer: '1' }),
      way(20, [3, 6, 4]),
    ]);
    const upperIds = new Set(
      result.edges.filter((e) => e.wayId === 10).flatMap((e) => [e.from, e.to]),
    );
    const lowerIds = new Set(
      result.edges.filter((e) => e.wayId === 20).flatMap((e) => [e.from, e.to]),
    );
    expect([...upperIds].filter((id) => lowerIds.has(id))).toEqual([]);
    expect(result.nodes.get(5)).toEqual(result.nodes.get(6));
  });

  it('匝道共用端点时保留跨层连接', () => {
    const result = buildTopology(nodes, [
      way(10, [1, 2], { bridge: 'yes', layer: '1' }),
      way(20, [3, 4], { layer: '0' }),
      { ...way(30, [2, 3], { oneway: 'yes' }), highway: 'primary_link' },
    ]);
    expect(pairs(result)).toEqual([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
      [2, 3],
    ]);
    expect(result.nodes.size).toBe(4);
    expect(result.issues).toEqual([]);
  });

  it.each(['bridge', 'tunnel'])('%s 本身不将双向道路变成单行，且保留原始结构标签', (structure) => {
    const result = buildTopology(nodes, [
      way(10, [1, 2], {
        [structure]: 'yes',
        layer: structure === 'bridge' ? '1' : '-1',
        oneway: 'no',
      }),
    ]);
    expect(pairs(result)).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(result.ways.get(10)?.tags).toEqual({
      [structure]: 'yes',
      layer: structure === 'bridge' ? '1' : '-1',
      oneway: 'no',
    });
    expect(result.edges.every((e) => e.wayId === 10)).toBe(true);
  });

  it.each([
    {
      oneway: 'yes',
      expected: [
        [1, 5],
        [5, 2],
      ],
    },
    {
      oneway: '-1',
      expected: [
        [5, 1],
        [2, 5],
      ],
    },
    {
      oneway: 'no',
      expected: [
        [1, 5],
        [5, 1],
        [5, 2],
        [2, 5],
      ],
    },
    {
      oneway: 'true',
      expected: [
        [1, 5],
        [5, 2],
      ],
    },
    {
      oneway: 'false',
      expected: [
        [1, 5],
        [5, 1],
        [5, 2],
        [2, 5],
      ],
    },
  ])('生成方向正确的相邻段：$oneway', ({ oneway, expected }) => {
    expect(pairs(buildTopology(nodes, [way(10, [1, 5, 2], { oneway })]))).toEqual(expected);
  });

  it('缺失中间节点不跨缺口连接，保留后续有效段', () => {
    const result = buildTopology(nodes, [way(10, [1, 999, 3, 4])]);
    expect(pairs(result)).toEqual([
      [3, 4],
      [4, 3],
    ]);
    expect(result.issues).toEqual([{ code: 'missing-node', wayId: 10, nodeId: 999 }]);
  });

  it('保留每段端点，因此原序列中间节点也可用于完整路径几何', () => {
    const result = buildTopology(nodes, [way(10, [1, 5, 2])]);
    expect([...result.nodes.keys()]).toEqual([1, 5, 2]);
    expect([1, 5, 2].map((id) => result.nodes.get(id))).toEqual([
      [30, 114],
      [30, 114.5],
      [30, 115],
    ]);
  });

  it('边 ID 不保证道路排序改变后的跨版本稳定性', () => {
    const first = buildTopology(nodes, [way(10, [1, 2]), way(20, [3, 4])]);
    const reordered = buildTopology(nodes, [way(20, [3, 4]), way(10, [1, 2])]);
    expect(first.edges.find((e) => e.wayId === 10)?.id).toBe(0);
    expect(reordered.edges.find((e) => e.wayId === 10)?.id).toBe(2);
  });

  it('非法坐标与节点 ID 不进入边', () => {
    const invalidNodes = new Map(nodes);
    invalidNodes.set(5, [NaN, 114]);
    invalidNodes.set(6, [91, 114]);
    invalidNodes.set(1.5, [30, 114]);
    const result = buildTopology(invalidNodes, [way(10, [1, 5, 6, 1.5, 2])]);
    expect(result.edges).toEqual([]);
    expect(result.issues.map((i) => [i.code, i.nodeId])).toEqual([
      ['invalid-node', 5],
      ['invalid-node', 6],
      ['invalid-node', 1.5],
    ]);
  });

  it('跳过退化段和短道路并报告位置', () => {
    const result = buildTopology(nodes, [way(10, [1, 1, 2]), way(20, [3])]);
    expect(pairs(result)).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(result.issues).toEqual([
      { code: 'degenerate-segment', wayId: 10, segmentIndex: 0 },
      { code: 'short-way', wayId: 20 },
    ]);
  });

  it('未知方向不生成猜测边', () => {
    const result = buildTopology(nodes, [way(10, [1, 2], { oneway: 'reversible' })]);
    expect(result.edges).toEqual([]);
    expect(result.issues).toEqual([{ code: 'unsupported-direction', wayId: 10 }]);
  });

  it('平行道路保留不同来源，边 ID 唯一且同输入结果稳定', () => {
    const ways = [way(10, [1, 2]), way(20, [1, 2])];
    const result = buildTopology(nodes, ways);
    expect(result.edges.map((e) => [e.id, e.wayId])).toEqual([
      [0, 10],
      [1, 10],
      [2, 20],
      [3, 20],
    ]);
    expect(buildTopology(nodes, ways)).toEqual(result);
  });

  it('非法和重复 way ID 不造成来源歧义', () => {
    const result = buildTopology(nodes, [way(10, [1, 2]), way(10, [3, 4]), way(1.5, [3, 4])]);
    expect(pairs(result)).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(result.issues).toEqual([
      { code: 'duplicate-way-id', wayId: 10 },
      { code: 'invalid-way-id', wayId: 1.5 },
    ]);
  });

  it('返回数据不与输入的标签及坐标共享可变对象', () => {
    const sourceWay = way(10, [1, 2], { bridge: 'viaduct' });
    const result = buildTopology(nodes, [sourceWay]);
    result.ways.get(10)!.tags['bridge'] = 'no';
    result.nodes.get(1)![0] = 0;
    expect(sourceWay.tags['bridge']).toBe('viaduct');
    expect(nodes.get(1)).toEqual([30, 114]);
  });
});

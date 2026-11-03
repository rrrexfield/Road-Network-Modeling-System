import { describe, expect, it } from 'vitest';
import type { TravelMode } from '@gisalgo/shared';
import { buildModalTopology, type TopologyWay } from './index';

const nodes = new Map<number, [number, number]>([
  [1, [30, 114]],
  [2, [30, 114.1]],
]);
const way = (highway: string, tags: Record<string, string> = {}, id = 10): TopologyWay => ({
  id,
  highway,
  tags,
  nds: [1, 2],
});
const count = (w: TopologyWay, mode: TravelMode) =>
  buildModalTopology(nodes, [w], mode).topology.edges.length;

describe('buildModalTopology', () => {
  it.each([
    { highway: 'residential', counts: [2, 2, 2, 2] },
    { highway: 'footway', counts: [0, 2, 0, 0] },
    { highway: 'steps', counts: [0, 2, 0, 0] },
    { highway: 'cycleway', counts: [0, 0, 2, 0] },
    { highway: 'busway', counts: [0, 0, 0, 2] },
    { highway: 'motorway', counts: [1, 0, 0, 1] },
    { highway: 'construction', counts: [0, 0, 0, 0] },
    { highway: 'proposed', counts: [0, 0, 0, 0] },
  ])('默认道路矩阵：$highway', ({ highway, counts }) => {
    expect((['car', 'walk', 'bike', 'bus'] as const).map((m) => count(way(highway), m))).toEqual(
      counts,
    );
  });

  it('步行忽略普通街道机动车单行，自行车可显式逆行例外', () => {
    const w = way('residential', { oneway: 'yes', 'oneway:bicycle': 'no' });
    expect(count(w, 'car')).toBe(1);
    expect(count(w, 'walk')).toBe(2);
    expect(count(w, 'bike')).toBe(2);
    expect(count(w, 'bus')).toBe(1);
  });

  it('具体准入覆盖宽泛禁行，公交专用权限不会放行汽车', () => {
    const w = way('residential', { access: 'no', bus: 'yes', foot: 'yes' });
    expect(count(w, 'bus')).toBe(2);
    expect(count(w, 'walk')).toBe(2);
    expect(count(w, 'car')).toBe(0);
    expect(count(w, 'bike')).toBe(0);
  });

  it('具体禁行优先于一般允许；未知等级仅在显式准入时进入', () => {
    expect(count(way('residential', { access: 'yes', bicycle: 'no' }), 'bike')).toBe(0);
    expect(count(way('unknown'), 'walk')).toBe(0);
    expect(count(way('unknown', { foot: 'yes' }), 'walk')).toBe(2);
    expect(count(way('footway', { access: 'yes' }), 'car')).toBe(0);
    expect(count(way('construction', { foot: 'yes' }), 'walk')).toBe(0);
  });

  it.each(['destination', 'customers', 'delivery', 'dismount'])(
    '未支持准入值%s排除并可追溯',
    (value) => {
      const result = buildModalTopology(nodes, [way('residential', { bicycle: value })], 'bike');
      expect(result.topology.edges).toEqual([]);
      expect(result.excludedWays).toEqual([{ wayId: 10, reason: `unsupported-access:${value}` }]);
    },
  );

  it('条件准入和方向性准入不会静默放行', () => {
    expect(
      buildModalTopology(
        nodes,
        [way('residential', { 'access:conditional': 'no @ (Mo-Fr)' })],
        'car',
      ).excludedWays[0]?.reason,
    ).toBe('conditional-access');
    expect(
      buildModalTopology(nodes, [way('residential', { 'bicycle:backward': 'no' })], 'bike')
        .excludedWays[0]?.reason,
    ).toBe('directional-access');
  });

  it('模态单行优先且方向条件记录为拓扑排除', () => {
    const w = way('residential', { oneway: 'yes', 'oneway:bus': '-1' });
    expect(buildModalTopology(nodes, [w], 'bus').topology.edges[0]).toMatchObject({
      from: 2,
      to: 1,
    });
    const conditional = buildModalTopology(
      nodes,
      [way('residential', { 'oneway:bicycle:conditional': 'no @ (Mo-Fr)' })],
      'bike',
    );
    expect(conditional.topology.edges).toEqual([]);
    expect(conditional.topology.issues[0]?.code).toBe('unsupported-direction');
  });

  it('原始属性和输入不被有效方向覆盖，各模式互相独立', () => {
    const w = way('residential', { oneway: 'yes' });
    const walk = buildModalTopology(nodes, [w], 'walk');
    expect(walk.topology.ways.get(10)?.tags).toEqual({ oneway: 'yes' });
    expect(w.tags).toEqual({ oneway: 'yes' });
    expect(count(w, 'car')).toBe(1);
    expect(walk.topology.edges).toHaveLength(2);
  });
});

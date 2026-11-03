import { describe, expect, it } from 'vitest';
import type { OsmRelation } from '../io/index';
import {
  importOsmRestrictions,
  buildTopology,
  createTopologyReport,
  type TopologyWay,
} from './index';

const edges = [
  { id: 0, from: 1, to: 2, wayId: 10 },
  { id: 1, from: 2, to: 3, wayId: 20 },
  { id: 2, from: 2, to: 4, wayId: 30 },
];
const relation = (kind = 'no_left_turn'): OsmRelation => ({
  id: 1,
  tags: [
    { k: 'type', v: 'restriction' },
    { k: 'restriction', v: kind },
  ],
  members: [
    { type: 'way', ref: 10, role: 'from' },
    { type: 'node', ref: 2, role: 'via' },
    { type: 'way', ref: 20, role: 'to' },
  ],
});
describe('OSM禁转导入', () => {
  it('from/via/to解析成source=osm的边对，并保留relation溯源', () => {
    const r = importOsmRestrictions([relation()], edges);
    expect(r.restrictions).toEqual([
      { id: 0, viaNode: 2, fromEdge: 0, toEdge: 1, type: 'no_left_turn', source: 'osm' },
    ]);
    expect(r.provenance).toEqual([{ restrictionId: 0, relationId: 1 }]);
    expect(r.issues).toEqual([]);
  });
  it('only直行禁止其余出口，不禁止指定目标', () => {
    expect(
      importOsmRestrictions([relation('only_straight_on')], edges).restrictions[0],
    ).toMatchObject({ fromEdge: 0, toEdge: 2, type: 'only_straight_on' });
  });
  it('条件、via-way、缺失与歧义均诊断，不猜测', () => {
    const conditional = relation();
    conditional.tags.push({ k: 'restriction:conditional', v: 'no_left_turn @ (Mo-Fr)' });
    expect(importOsmRestrictions([conditional], edges).issues[0]?.reason).toBe(
      'conditional-restriction',
    );
    const via = relation();
    via.members[1]!.type = 'way';
    expect(importOsmRestrictions([via], edges).issues[0]?.reason).toBe(
      'unsupported-or-invalid-members',
    );
    expect(importOsmRestrictions([relation()], edges.slice(0, 1)).issues[0]?.reason).toBe(
      'missing-edge-pair',
    );
    expect(
      importOsmRestrictions([relation()], [...edges, { id: 3, from: 5, to: 2, wayId: 10 }])
        .issues[0]?.reason,
    ).toBe('ambiguous-edge-pair');
  });
  it('车辆禁转不应用到步行，except=psv不限制公交', () => {
    expect(importOsmRestrictions([relation()], edges, 'walk').restrictions).toEqual([]);
    const r = relation();
    r.tags.push({ k: 'except', v: 'psv;bicycle' });
    expect(importOsmRestrictions([r], edges, 'bus').ignored[0]?.reason).toBe('mode-exception');
    expect(importOsmRestrictions([r], edges, 'car').restrictions).toHaveLength(1);
  });
});
describe('结构冲突报告', () => {
  it('不同layer道路内部共享节点进入报告；普通桥端衔接不误报', () => {
    const nodes = new Map<number, [number, number]>([
      [1, [30, 114]],
      [2, [30, 114.1]],
      [3, [30, 114.2]],
      [4, [29, 114.1]],
      [5, [31, 114.1]],
    ]);
    const ways: TopologyWay[] = [
      { id: 10, highway: 'residential', tags: { bridge: 'yes', layer: '1' }, nds: [1, 2, 3] },
      { id: 20, highway: 'residential', tags: { layer: '0' }, nds: [4, 2, 5] },
    ];
    const report = createTopologyReport(buildTopology(nodes, ways));
    expect(report.structureConflicts[0]?.nodeId).toBe(2);
    const endpoint = buildTopology(nodes, [ways[0]!, { ...ways[1]!, nds: [2, 5] }]);
    expect(createTopologyReport(endpoint).structureConflicts).toEqual([]);
  });
});

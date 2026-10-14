import { describe, expect, it } from 'vitest';
import { buildTopology, createTopologyReport, type TopologyWay } from './index';

const nodes = new Map<number, [number, number]>([
  [1, [30, 114]],
  [2, [30, 115]],
]);
const way = (id: number, tags: Record<string, string>, highway = 'residential'): TopologyWay => ({
  id,
  nds: [1, 2],
  highway,
  tags,
});

describe('createTopologyReport', () => {
  it('未标方向的高速匝道明确列出原因，不冒充已构建道路', () => {
    const report = createTopologyReport(buildTopology(nodes, [way(10, {}, 'motorway_link')]));
    expect(report.scope).toBe('input-roads-without-mode-filter');
    expect(report.retainedWayCount).toBe(1);
    expect(report.builtWayCount).toBe(0);
    expect(report.edgeCount).toBe(0);
    expect(report.excludedDirectionWays).toEqual([
      {
        wayId: 10,
        highway: 'motorway_link',
        oneway: null,
        conditional: null,
        reason: 'missing-motorway-link-direction',
      },
    ]);
    expect(report.issueCounts).toEqual({ 'unsupported-direction': 1 });
  });

  it('条件方向和可变方向保留原始依据且不生成猜测边', () => {
    const report = createTopologyReport(
      buildTopology(nodes, [
        way(10, { oneway: 'yes', 'oneway:conditional': 'no @ (Mo-Fr 08:00-10:00)' }),
        way(20, { oneway: 'reversible' }),
        way(30, { oneway: 'alternating' }),
      ]),
    );
    expect(report.builtWayCount).toBe(0);
    expect(
      report.excludedDirectionWays.map((w) => [w.wayId, w.reason, w.oneway, w.conditional]),
    ).toEqual([
      [10, 'conditional-direction', 'yes', 'no @ (Mo-Fr 08:00-10:00)'],
      [20, 'unsupported-oneway', 'reversible', null],
      [30, 'unsupported-oneway', 'alternating', null],
    ]);
  });

  it('全道路口径显式标识，不把步行和规划道路描述为汽车道路', () => {
    const report = createTopologyReport(
      buildTopology(nodes, [
        way(10, {}, 'footway'),
        way(20, {}, 'steps'),
        way(30, {}, 'construction'),
        way(40, {}, 'proposed'),
      ]),
    );
    expect(report.scope).toBe('input-roads-without-mode-filter');
    expect(report.builtWayCount).toBe(4);
    expect(report.edgeCount).toBe(8);
    expect(report.excludedDirectionWays).toEqual([]);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('空图报告计数为零', () => {
    expect(createTopologyReport(buildTopology(nodes, []))).toEqual({
      scope: 'input-roads-without-mode-filter',
      nodeCount: 0,
      edgeCount: 0,
      retainedWayCount: 0,
      builtWayCount: 0,
      issueCounts: {},
      excludedDirectionWays: [],
    });
  });
});

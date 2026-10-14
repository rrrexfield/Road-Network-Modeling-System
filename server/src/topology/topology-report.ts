import type { TopologyIssue, TopologyResult } from './build-topology.js';

export interface TopologyReport {
  /** 不进行模态过滤，不能将本报告解释为汽车路网的通行性报告。 */
  scope: 'input-roads-without-mode-filter';
  nodeCount: number;
  edgeCount: number;
  /** 通过 ID 校验并保留属性的道路数，不等于原始输入道路数。 */
  retainedWayCount: number;
  builtWayCount: number;
  issueCounts: Partial<Record<TopologyIssue['code'], number>>;
  excludedDirectionWays: {
    wayId: number;
    highway: string;
    oneway: string | null;
    conditional: string | null;
    reason: 'conditional-direction' | 'missing-motorway-link-direction' | 'unsupported-oneway';
  }[];
}

/**
 * 将构边结果整理为可序列化报告，显式列出因方向不确定而未进入图的道路。
 * @param topology buildTopology 的结果。
 * @returns 数量、输入图口径、诊断计数和被排除道路的方向依据。
 * @remarks 此报告不计算连通性；A 可与 B 的统计结果合并后呈现。复杂度 O(E + issues)。
 */
export function createTopologyReport(topology: TopologyResult): TopologyReport {
  const issueCounts: TopologyReport['issueCounts'] = {};
  const excludedDirectionWays: TopologyReport['excludedDirectionWays'] = [];
  for (const issue of topology.issues) {
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    if (issue.code !== 'unsupported-direction') continue;
    const way = topology.ways.get(issue.wayId)!;
    const conditional = way.tags['oneway:conditional'] ?? null;
    const oneway = way.tags['oneway'] ?? null;
    excludedDirectionWays.push({
      wayId: way.id,
      highway: way.highway,
      oneway,
      conditional,
      reason:
        conditional !== null
          ? 'conditional-direction'
          : way.highway === 'motorway_link' && oneway === null
            ? 'missing-motorway-link-direction'
            : 'unsupported-oneway',
    });
  }
  const builtWayIds = new Set<number>();
  for (const edge of topology.edges) builtWayIds.add(edge.wayId);
  return {
    scope: 'input-roads-without-mode-filter',
    nodeCount: topology.nodes.size,
    edgeCount: topology.edges.length,
    retainedWayCount: topology.ways.size,
    builtWayCount: builtWayIds.size,
    issueCounts,
    excludedDirectionWays,
  };
}

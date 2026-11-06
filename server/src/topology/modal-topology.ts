import type { TravelMode } from '@gisalgo/shared';
import { buildTopology, type TopologyResult, type TopologyWay } from './build-topology.js';
import {
  accessKeys,
  applyNodeAccess,
  type NodeTags,
  type NodeAccessReport,
} from './node-access.js';

const motorRoads = [
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
];
const localRoads = motorRoads.filter(
  (h) => !['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(h),
);
const defaults: Record<TravelMode, ReadonlySet<string>> = {
  car: new Set(motorRoads),
  bus: new Set([...motorRoads, 'busway']),
  walk: new Set([...localRoads, 'footway', 'pedestrian', 'path', 'steps', 'track', 'corridor']),
  bike: new Set([...localRoads, 'cycleway', 'path', 'track']),
};
const directionKeys: Record<TravelMode, readonly string[]> = {
  car: ['oneway:motorcar', 'oneway:motor_vehicle', 'oneway:vehicle', 'oneway'],
  bus: ['oneway:bus', 'oneway:psv', 'oneway:motor_vehicle', 'oneway:vehicle', 'oneway'],
  bike: ['oneway:bicycle', 'oneway:vehicle', 'oneway'],
  walk: ['oneway:foot'],
};

export interface ModalTopologyResult {
  nodeAccess: NodeAccessReport;
  mode: TravelMode;
  topology: TopologyResult;
  /** 准入排除；方向与数据质量排除另见 topology.issues，不可忽略。 */
  excludedWays: { wayId: number; reason: string }[];
}

/**
 * 独立构建指定模式的基础道路图，原输入和输出道路属性均保持原义。
 * @remarks 默认等级为项目保守策略；更具体准入优先，条件/目的地/私有等未支持语义排除并报告。
 * 各模式必须分别建立 Graph 与禁转索引，edgeId 不能跨模式复用。
 * bus 只表示公交通行道路，不含真实线路、班次或停站规则。
 * 可选nodeTags用于节点准入；未传时nodeAccess.checked=false，兼容旧调用但不表示权限已核验。
 */
export function buildModalTopology(
  nodes: ReadonlyMap<number, readonly [number, number]>,
  ways: readonly TopologyWay[],
  mode: TravelMode,
  nodeTags?: NodeTags,
): ModalTopologyResult {
  if (!Object.hasOwn(defaults, mode)) throw new Error(`未知交通模式: ${mode}`);
  const selected: TopologyWay[] = [];
  const originals = new Map<number, TopologyWay>();
  const excludedWays: ModalTopologyResult['excludedWays'] = [];
  for (const way of ways) {
    let reason: string | undefined;
    if (['construction', 'proposed'].includes(way.highway)) reason = 'inactive-highway';
    const keys = accessKeys[mode];
    if (!reason && keys.some((k) => way.tags[`${k}:conditional`] !== undefined))
      reason = 'conditional-access';
    if (
      !reason &&
      keys.some(
        (k) => way.tags[`${k}:forward`] !== undefined || way.tags[`${k}:backward`] !== undefined,
      )
    ) {
      reason = 'directional-access';
    }
    const explicitKey = keys.find((k) => way.tags[k] !== undefined);
    const explicit = explicitKey === undefined ? undefined : way.tags[explicitKey];
    if (!reason && explicit !== undefined) {
      if (['no', 'private'].includes(explicit)) reason = 'access-denied';
      else if (!['yes', 'designated', 'permissive'].includes(explicit))
        reason = `unsupported-access:${explicit}`;
      else if (explicitKey === 'access' && !defaults[mode].has(way.highway))
        reason = 'highway-not-allowed';
    } else if (!reason && !defaults[mode].has(way.highway)) reason = 'highway-not-allowed';
    if (reason) {
      excludedWays.push({ wayId: way.id, reason });
      continue;
    }

    const tags = { ...way.tags };
    const directions = directionKeys[mode];
    const hasConditional = directions.some((k) => way.tags[`${k}:conditional`] !== undefined);
    const explicitDirection = directions.map((k) => way.tags[k]).find((v) => v !== undefined);
    delete tags['oneway:conditional'];
    if (hasConditional) tags['oneway:conditional'] = 'unsupported';
    if (mode === 'walk') {
      // 普通街道的机动车单行不限制步行；步行专属设施的泛化标签另行保守处理。
      const pedestrianFacility = ['steps', 'footway', 'path', 'corridor'].includes(way.highway);
      if (explicitDirection !== undefined) tags.oneway = explicitDirection;
      else if (pedestrianFacility && way.tags.oneway !== undefined) {
        tags.oneway = way.highway === 'steps' ? way.tags.oneway : 'unsupported';
        if (way.tags['oneway:conditional'] !== undefined)
          tags['oneway:conditional'] = 'unsupported';
      } else tags.oneway = 'no';
    } else if (explicitDirection !== undefined) tags.oneway = explicitDirection;
    selected.push({ ...way, tags });
    if (!originals.has(way.id)) originals.set(way.id, way);
  }
  const topology = buildTopology(nodes, selected);
  // 构边使用临时有效方向，不篡改公开道路属性的原始 oneway 标签。
  for (const [id, properties] of topology.ways) properties.tags = { ...originals.get(id)!.tags };
  const nodeAccess = applyNodeAccess(topology, mode, nodeTags);
  return { mode, topology, excludedWays, nodeAccess };
}

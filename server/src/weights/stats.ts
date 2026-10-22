/**
 * 网络统计分析:里程、等级分布、边长分布与通行时间。
 * 输入的边集是 C 的构边产物、坐标表来自派生数据、way→等级表用于取限速——本模块只做聚合,
 * 不负责读文件、不负责建图。
 *
 * **边长口径**:调用方可通过 `StatsInput.edgeLength` 注入 B 的 `Graph.edgeLength`(Float32
 * 预计算,与路径权重同源);未注入时回退到本模块 `geo.ts` 的 `haversineMeters`(原始 float64
 * 坐标),两者数值不严格相等(分轴最坏 ~0.7 m)。服务端启动组装出 Graph 后一律走注入路径。
 */
import type {
  HighwayStat,
  LengthBucket,
  NetworkStats,
  RoadEdge,
  TopologyMetrics,
  TopologyMetricsSourceTag,
  TopologyStats,
  WeightProfile,
} from '@gisalgo/shared';
import { haversineMeters } from './geo.js';
import { travelSeconds } from './speed.js';
import {
  DEFAULT_WEIGHT_PROFILE,
  UNKNOWN_HIGHWAY,
  effectiveSpeedKmh,
  normalizeWeightProfile,
  type NetworkContext,
} from './weight.js';

/** 统计响应体与子类型由 shared 冻结；本模块只 re-export，不再定义本地副本。 */
export type {
  HighwayStat,
  LengthBucket,
  NetworkStats,
  TopologyMetrics,
  TopologyMetricsSourceTag,
};

/** 统计输入:在权重上下文之上补一份边集。 */
export interface StatsInput extends NetworkContext {
  edges: readonly RoadEdge[];
  /**
   * 可选边长来源(米);提供时优先于本地 Haversine,例如注入 `Graph.edgeLength`。
   * 返回非有限值的边按缺失端点同样跳过。
   */
  edgeLength?: (edge: RoadEdge) => number;
}

/** 直方图分档上界(米),最后一档为无上界的开区间。 */
const HISTOGRAM_BOUNDS_M = [20, 50, 100, 200, 500, 1000] as const;

interface HighwayAccumulator {
  edgeCount: number;
  lengthMeters: number;
  travelSeconds: number;
}

/** 取中位数;偶数个取中间两个的均值。空序列返回 0。 */
function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 按固定分档统计边长分布;区间为左闭右开。 */
function buildLengthHistogram(lengths: readonly number[]): LengthBucket[] {
  const buckets: LengthBucket[] = [];
  let lower = 0;
  for (const upper of HISTOGRAM_BOUNDS_M) {
    buckets.push({
      label: `${lower}–${upper} m`,
      minMeters: lower,
      maxMeters: upper,
      edgeCount: 0,
    });
    lower = upper;
  }
  buckets.push({ label: `≥${lower} m`, minMeters: lower, maxMeters: null, edgeCount: 0 });

  for (const length of lengths) {
    const index = HISTOGRAM_BOUNDS_M.findIndex((upper) => length < upper);
    buckets[index === -1 ? buckets.length - 1 : index]!.edgeCount += 1;
  }
  return buckets;
}

/**
 * 把 B 的拓扑指标 Map 转换为可序列化形态(即 shared JSDoc 要求的"API 层转换")。
 * @param source B 的 `computeTopologyStats` 产物。
 * @returns 度分布按度升序排列的纯数组结构。
 * @remarks 复杂度 O(d log d),d 为不同度的个数。度分布排序是 D 侧的呈现约定:
 * B 的 Map 为节点迭代序(无序),直接下发会让前端每次刷新看到不同的顺序。
 */
export function toTopologyMetrics(source: TopologyStats): TopologyMetrics {
  return {
    nodeCount: source.nodeCount,
    edgeCount: source.edgeCount,
    connectedComponentCount: source.connectedComponentCount,
    largestComponentSize: source.largestComponentSize,
    danglingNodeCount: source.danglingNodeCount,
    isolatedNodeCount: source.isolatedNodeCount,
    averageDegree: source.averageDegree,
    degreeDistribution: [...source.degreeDistribution.entries()]
      .map(([degree, count]) => ({ degree, count }))
      .sort((a, b) => a.degree - b.degree),
  };
}

/**
 * 计算网络统计。
 * @param input 坐标表、边集、way→等级表与可选的边长注入函数。
 * @param options.profile 权重配置;省略用默认配置。
 * @param options.topology B 的图引擎拓扑指标(`TopologyStats`);省略时 topology 为 null、
 * topologySource 为 'pending'。M1 为全道路拓扑(与 C 构边口径一致,不做模态过滤),
 * 模态子图待准入规则立项后再另立口径。
 * @returns 里程、时间、等级分布、边长分布与拓扑指标。
 * @remarks 端点缺失或边长非有限的边整体跳过,不按 0 米计入——否则会把"未知长度"伪装成
 * 极短边,既拉低平均边长也污染直方图。里程与时间分别累加,等级平均速度由二者反算,
 * 因此不受逐条舍入影响。复杂度 O(E log E),排序用于取中位数与整理等级表。
 */
export function computeNetworkStats(
  input: StatsInput,
  options?: { profile?: WeightProfile; topology?: TopologyStats | null },
): NetworkStats {
  const profile = normalizeWeightProfile(options?.profile ?? DEFAULT_WEIGHT_PROFILE);

  const speedCache = new Map<string, number>();
  const speedFor = (highway: string): number => {
    let speed = speedCache.get(highway);
    if (speed === undefined) {
      speed = effectiveSpeedKmh(highway, profile);
      speedCache.set(highway, speed);
    }
    return speed;
  };

  const ways = new Set<number>();
  const byHighway = new Map<string, HighwayAccumulator>();
  const lengths: number[] = [];
  let totalLengthMeters = 0;
  let totalTravelSeconds = 0;
  let minEdgeMeters = Number.POSITIVE_INFINITY;
  let maxEdgeMeters = 0;
  let edgeCount = 0;

  for (const edge of input.edges) {
    const from = input.nodes.get(edge.from);
    const to = input.nodes.get(edge.to);
    if (from === undefined || to === undefined) continue;

    const lengthMeters = input.edgeLength?.(edge) ?? haversineMeters(from, to);
    if (!Number.isFinite(lengthMeters)) continue;
    const highway = input.wayHighway.get(edge.wayId) ?? UNKNOWN_HIGHWAY;
    const seconds = travelSeconds(lengthMeters, speedFor(highway));

    edgeCount += 1;
    ways.add(edge.wayId);
    lengths.push(lengthMeters);
    totalLengthMeters += lengthMeters;
    if (lengthMeters < minEdgeMeters) minEdgeMeters = lengthMeters;
    if (lengthMeters > maxEdgeMeters) maxEdgeMeters = lengthMeters;

    const accumulator = byHighway.get(highway);
    if (accumulator === undefined) {
      byHighway.set(highway, { edgeCount: 1, lengthMeters, travelSeconds: seconds });
    } else {
      accumulator.edgeCount += 1;
      accumulator.lengthMeters += lengthMeters;
      if (Number.isFinite(seconds)) accumulator.travelSeconds += seconds;
    }
    if (Number.isFinite(seconds)) totalTravelSeconds += seconds;
  }

  // 首次出现的等级可能是不可通行(Infinity),此处统一把非有限值归零,避免响应体出现 Infinity
  for (const accumulator of byHighway.values()) {
    if (!Number.isFinite(accumulator.travelSeconds)) accumulator.travelSeconds = 0;
  }

  const byHighwayList: HighwayStat[] = [...byHighway.entries()]
    .map(([highway, accumulator]) => ({
      highway,
      edgeCount: accumulator.edgeCount,
      lengthMeters: accumulator.lengthMeters,
      lengthShare: totalLengthMeters > 0 ? accumulator.lengthMeters / totalLengthMeters : 0,
      averageSpeedKmh:
        accumulator.lengthMeters > 0 && accumulator.travelSeconds > 0
          ? accumulator.lengthMeters / 1000 / (accumulator.travelSeconds / 3600)
          : 0,
      travelSeconds: accumulator.travelSeconds,
    }))
    .sort((a, b) => b.lengthMeters - a.lengthMeters);

  const topology = options?.topology;
  return {
    nodeCount: input.nodes.size,
    edgeCount,
    wayCount: ways.size,
    totalLengthMeters,
    totalTravelSeconds,
    minEdgeMeters: Number.isFinite(minEdgeMeters) ? minEdgeMeters : 0,
    maxEdgeMeters,
    meanEdgeMeters: edgeCount > 0 ? totalLengthMeters / edgeCount : 0,
    medianEdgeMeters: median([...lengths].sort((a, b) => a - b)),
    byHighway: byHighwayList,
    lengthHistogram: buildLengthHistogram(lengths),
    topology: topology ? toTopologyMetrics(topology) : null,
    topologySource: topology ? 'graph-engine' : 'pending',
    profile,
  };
}

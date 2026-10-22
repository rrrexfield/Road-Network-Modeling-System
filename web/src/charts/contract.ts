/**
 * 【临时契约镜像】`server/src/weights` 的权重 / 统计出入参在前端的只读镜像。
 *
 * TODO(契约·A): 按 AGENTS.md「跨端契约类型统一定义于 shared/src/index.ts,前后端禁止重复定义」,
 * 下列类型需由 A 评审后提升到 shared;提升完成后本文件整体删除,改从 `@gisalgo/shared` 导入。
 * 在提升之前,前端只依赖此镜像,避免直接耦合 server 包源码。
 * 关联 issue: #10(与 B 的 issue #4 同批处理)。
 *
 * 其中 `TopologyMetrics` 已改为从 shared 的 `TopologyStats` 派生——#14 已把 `TopologyStats`
 * 冻结进 shared,拓扑部分不再是"第二份定义",仅保留 Map→数组的序列化形态差异。
 */
import type { TopologyStats } from '@gisalgo/shared';

/** 权重配置。 */
export interface WeightProfile {
  /** 优化目标:distance = 里程最短,time = 用时最短。 */
  metric: 'distance' | 'time';
  /** 全局速度系数,>0;1 表示按各等级默认限速。 */
  speedFactor: number;
  /** 等级 → 限速(km/h)覆盖表。 */
  speedOverridesKmh: Record<string, number>;
}

/** 单个 highway 等级的统计口径。 */
export interface HighwayStat {
  highway: string;
  edgeCount: number;
  lengthMeters: number;
  /** 里程占比(0–1)。 */
  lengthShare: number;
  averageSpeedKmh: number;
  travelSeconds: number;
}

/** 边长分布直方图的一档。 */
export interface LengthBucket {
  label: string;
  minMeters: number;
  maxMeters: number | null;
  edgeCount: number;
}

/**
 * 可序列化的拓扑指标。
 * 由 A 已冻结进 shared 的 `TopologyStats` **派生**,与服务端 `TopologyMetrics` 同形:
 * 除 `degreeDistribution` 摊成数组外其余字段直接继承,避免前后端两份平铺定义漂移。
 */
export interface TopologyMetrics extends Omit<TopologyStats, 'degreeDistribution'> {
  degreeDistribution: { degree: number; count: number }[];
}

/** 拓扑指标来源标注;用语义名而非模块路径,避免目录改名就失效。 */
export type TopologyMetricsSourceTag = 'graph-engine' | 'pending';

/** `GET /api/stats` 响应体。 */
export interface NetworkStats {
  nodeCount: number;
  edgeCount: number;
  wayCount: number;
  totalLengthMeters: number;
  totalTravelSeconds: number;
  minEdgeMeters: number;
  maxEdgeMeters: number;
  meanEdgeMeters: number;
  medianEdgeMeters: number;
  byHighway: HighwayStat[];
  lengthHistogram: LengthBucket[];
  topology: TopologyMetrics | null;
  topologySource: TopologyMetricsSourceTag;
  profile: WeightProfile;
}

/** `GET /api/weights/profile` 响应体。 */
export interface WeightProfileResponse {
  default: WeightProfile;
  speedTable: Record<string, number>;
}

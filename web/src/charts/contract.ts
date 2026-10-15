/**
 * 【临时契约镜像】`server/src/weights` 的权重 / 统计出入参在前端的只读镜像。
 *
 * TODO(契约·A): 按 AGENTS.md「跨端契约类型统一定义于 shared/src/index.ts,前后端禁止重复定义」,
 * 下列类型需由 A 评审后提升到 shared;提升完成后本文件整体删除,改从 `@gisalgo/shared` 导入。
 * 在提升之前,前端只依赖此镜像,避免直接耦合 server 包源码。
 * 关联 issue:见 D 提交的契约 issue(与 B 的 issue #4 同批处理)。
 */

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

/** 可序列化的拓扑指标。 */
export interface TopologyMetrics {
  nodeCount: number;
  edgeCount: number;
  connectedComponentCount: number;
  largestComponentSize: number;
  danglingNodeCount: number;
  isolatedNodeCount: number;
  averageDegree: number;
  degreeDistribution: { degree: number; count: number }[];
}

/** 拓扑指标来源标注。 */
export type TopologyMetricsSourceTag = 'server/src/graph(graph-engine)' | 'pending';

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

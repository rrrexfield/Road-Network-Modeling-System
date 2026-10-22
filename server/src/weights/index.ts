/**
 * 权重与统计模块公开入口。
 * 跨目录引用一律经本文件(AGENTS.md 目录所有权约定),禁止深引用内部文件。
 */
export { EARTH_RADIUS_M, haversineMeters } from './geo.js';
export { DEFAULT_SPEED_KMH, FALLBACK_SPEED_KMH, speedKmh, travelSeconds } from './speed.js';
export {
  DEFAULT_WEIGHT_PROFILE,
  UNKNOWN_HIGHWAY,
  createDistanceWeight,
  createEdgeWeight,
  createTimeWeight,
  effectiveSpeedKmh,
  normalizeWeightProfile,
  type EdgeWeightFn,
  type NetworkContext,
  type WeightProfile,
} from './weight.js';
export {
  computeNetworkStats,
  toTopologyMetrics,
  type HighwayStat,
  type LengthBucket,
  type NetworkStats,
  type StatsInput,
  type TopologyMetrics,
  type TopologyMetricsSourceTag,
} from './stats.js';
export {
  registerWeightRoutes,
  type WeightRoutesOptions,
  type WeightProfileResponse,
} from './routes.js';

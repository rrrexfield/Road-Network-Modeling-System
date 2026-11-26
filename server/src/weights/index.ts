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
  computeAttributeCompleteness,
  toTopologyMetrics,
  type HighwayStat,
  type LengthBucket,
  type NetworkStats,
  type StatWay,
  type StatsInput,
  type TopologyMetrics,
  type TopologyMetricsSourceTag,
} from './stats.js';
export {
  BIKE_FALLBACK_SPEED_KMH,
  BIKE_SPEED_KMH,
  BUS_SPEED_FACTOR,
  BUSWAY_SPEED_KMH,
  MODE_FALLBACK_SPEED_KMH,
  modeSpeedKmh,
  WALK_FALLBACK_SPEED_KMH,
  WALK_SPEED_KMH,
  createModeEdgeWeight,
  effectiveModeSpeedKmh,
  transferPenaltySeconds,
  TRANSFER_PENALTY_MINUTES,
} from './mode-weight.js';
export {
  parseWeightProfileParams,
  parseTrafficParams,
  registerWeightRoutes,
  type WeightRoutesOptions,
} from './routes.js';
export {
  computeAccessibility,
  type AccessibilityInput,
  type AccessibilityReport,
} from './accessibility.js';
export {
  congestionFactorAt,
  curveFactorAtHour,
  buildEventLookup,
  normalizeCongestionProfile,
  slotCount,
  slotIndexForHour,
  clampHourOfDay,
  DEFAULT_CONGESTION_CURVE,
  DEFAULT_CONGESTION_PROFILE,
  DEFAULT_HIGHWAY_SENSITIVITY,
  isExplicitOff,
  type CongestionAnchor,
  type CongestionProfile,
  type EventEffect,
  type TrafficConditions,
  type TrafficEvent,
  type TrafficEventKind,
} from './traffic.js';
export type { WeightProfileResponse } from '@gisalgo/shared';

/**
 * 权重与统计的 REST 路由,以 Fastify 插件形式提供。
 *
 * TODO(集成·A): 本插件尚未注册到服务端。请在 `server/src/index.ts` 增加
 * `await app.register(registerWeightRoutes, { network });`(network 为 loadNetwork 的产物,
 * 再补一份 wayId → highway 表;若 C 的 buildTopology 产物已接入,也可直接传其 nodes/edges)。
 * 详情见 issue #9。
 */
import type { FastifyInstance } from 'fastify';
import { DEFAULT_SPEED_KMH } from './speed.js';
import { DEFAULT_WEIGHT_PROFILE, normalizeWeightProfile, type WeightProfile } from './weight.js';
import {
  computeNetworkStats,
  type NetworkStats,
  type StatsInput,
  type TopologyMetricsSource,
} from './stats.js';

/** 插件选项。 */
export interface WeightRoutesOptions {
  /** 统计输入:坐标表 + 边集 + way→等级表。 */
  network: StatsInput;
  /** B 的图引擎拓扑指标;未接入时省略,响应 topology 为 null。 */
  topology?: TopologyMetricsSource;
}

/** 权重配置基线响应。 */
export interface WeightProfileResponse {
  default: WeightProfile;
  /** 各等级默认限速(km/h),前端面板据此渲染限速输入项。 */
  speedTable: Readonly<Record<string, number>>;
}

/** 解析查询串里的正有限数;缺省、空串、非数字或非正数一律返回 undefined。 */
function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** 解析 `speedKmh=primary:45,residential:25` 形态的等级限速覆盖;非法条目直接丢弃。 */
function parseSpeedOverrides(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const overrides: Record<string, number> = {};
  for (const pair of value.split(',')) {
    const separator = pair.indexOf(':');
    if (separator <= 0) continue;
    const highway = pair.slice(0, separator).trim();
    const speed = parsePositiveNumber(pair.slice(separator + 1));
    if (highway === '' || speed === undefined) continue;
    overrides[highway] = speed;
  }
  return overrides;
}

/**
 * 注册 `/api/weights/profile` 与 `/api/stats`。
 * @param app Fastify 实例。
 * @param options 统计输入与可选拓扑指标。
 * @remarks 统计按请求实时计算,不做缓存:请求体量取决于边集,接入 120 万边规模时再接
 * 缓存或预计算(性能预算见 issue)。
 */
export async function registerWeightRoutes(
  app: FastifyInstance,
  options: WeightRoutesOptions,
): Promise<void> {
  const { network, topology } = options;

  app.get('/api/weights/profile', (): WeightProfileResponse => ({
    default: DEFAULT_WEIGHT_PROFILE,
    speedTable: DEFAULT_SPEED_KMH,
  }));

  app.get('/api/stats', (request): NetworkStats => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const profile: Partial<WeightProfile> = {};
    const metric = query['metric'];
    if (metric === 'distance' || metric === 'time') profile.metric = metric;
    const speedFactor = parsePositiveNumber(query['speedFactor']);
    if (speedFactor !== undefined) profile.speedFactor = speedFactor;
    const speedOverridesKmh = parseSpeedOverrides(query['speedKmh']);
    if (speedOverridesKmh !== undefined) profile.speedOverridesKmh = speedOverridesKmh;

    return computeNetworkStats(network, { profile: normalizeWeightProfile(profile), topology });
  });
}

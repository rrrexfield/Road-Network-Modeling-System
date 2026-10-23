/**
 * 权重与统计的 REST 路由,以 Fastify 插件形式提供。
 * 由 `server/src/index.ts` 在组装出 Graph 之后注册(issue #9)。
 */
import type { FastifyInstance } from 'fastify';
import type { TopologyStats, WeightProfileResponse } from '@gisalgo/shared';
import { DEFAULT_SPEED_KMH } from './speed.js';
import { DEFAULT_WEIGHT_PROFILE, normalizeWeightProfile, type WeightProfile } from './weight.js';
import { computeNetworkStats, type NetworkStats, type StatsInput } from './stats.js';

/** 插件选项。 */
export interface WeightRoutesOptions {
  /** 统计输入:坐标表 + 边集 + way→等级表。 */
  network: StatsInput;
  /** B 的图引擎拓扑指标(shared 的 TopologyStats);未接入时省略,响应 topology 为 null。 */
  topology?: TopologyStats;
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

/** 统计缓存上限;超过后淘汰最早插入的配置,避免任意查询参数无限占内存。 */
const STATS_CACHE_LIMIT = 32;

/** 归一化配置 → 稳定缓存 key;覆盖表排序后生成,与查询串输入顺序无关。 */
function profileCacheKey(profile: WeightProfile): string {
  const overrides = Object.entries(profile.speedOverridesKmh).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify([profile.metric, profile.speedFactor, overrides]);
}

/**
 * 注册 `/api/weights/profile` 与 `/api/stats`。
 * @param app Fastify 实例。
 * @param options 统计输入与可选拓扑指标。
 * @remarks 统计结果按配置缓存(上限 32),注册时预热默认配置;全量约 120 万条有向边,
 * 实时重算的排序与聚合成本不宜按每次请求承担。
 */
export async function registerWeightRoutes(
  app: FastifyInstance,
  options: WeightRoutesOptions,
): Promise<void> {
  const { network, topology } = options;

  const cache = new Map<string, NetworkStats>();
  const statsFor = (profile: WeightProfile): NetworkStats => {
    const key = profileCacheKey(profile);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const stats = computeNetworkStats(network, { profile, topology });
    if (cache.size >= STATS_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, stats);
    return stats;
  };

  const warmupStartedAt = performance.now();
  statsFor(DEFAULT_WEIGHT_PROFILE);
  app.log.info(`统计缓存预热完成: ${Math.round(performance.now() - warmupStartedAt)} ms`);

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

    return statsFor(normalizeWeightProfile(profile));
  });
}

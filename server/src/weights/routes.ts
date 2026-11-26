/**
 * 权重与统计的 REST 路由,以 Fastify 插件形式提供。
 * 由 `server/src/index.ts` 在组装出 Graph 之后注册(issue #9)。
 *
 * Sprint 3(issue #65):新增 /api/accessibility(等时圈可达性)与 /api/weights/traffic
 * (拥堵曲线/事件场景下发,供前端面板与 E 的动画对齐);权重参数解析仍收口在
 * parseWeightProfileParams,/api/path 与 /api/stats 共用;交通参数解析同样收口在本模块。
 */
import type { FastifyInstance } from 'fastify';
import type { TopologyStats, TravelMode, WeightProfileResponse } from '@gisalgo/shared';
import { DEFAULT_SPEED_KMH } from './speed.js';
import { DEFAULT_WEIGHT_PROFILE, normalizeWeightProfile, type WeightProfile } from './weight.js';
import { computeNetworkStats, type NetworkStats, type StatsInput } from './stats.js';
import { computeAccessibility, type AccessibilityReport } from './accessibility.js';
import {
  DEFAULT_CONGESTION_PROFILE,
  isExplicitOff,
  normalizeCongestionProfile,
  type TrafficConditions,
  type TrafficEvent,
} from './traffic.js';

/** 插件选项。 */
export interface WeightRoutesOptions {
  /** 统计输入:坐标表 + 边集 + way→等级表 + way 标签表。 */
  network: StatsInput;
  /** B 的图引擎拓扑指标(shared 的 TopologyStats);未接入时省略,响应 topology 为 null。 */
  topology?: TopologyStats;
  /**
   * 服务端预置的交通事件场景(Sprint 3 确定性模拟,不接外部实时数据源)。
   * 由组装层(A)传入;查询串 events=off 可按次关闭。缺省无事件。
   */
  events?: readonly TrafficEvent[];
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

/** 可达性缓存上限(限界 Dijkstra 单次 O(E log V),结果按参数缓存复用)。 */
const ACCESSIBILITY_CACHE_LIMIT = 16;

/** 归一化配置 → 稳定缓存 key;覆盖表排序后生成,与查询串输入顺序无关。 */
function profileCacheKey(profile: WeightProfile, hourOfDay?: number): string {
  const overrides = Object.entries(profile.speedOverridesKmh).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify([profile.metric, profile.speedFactor, overrides, hourOfDay ?? null]);
}

/**
 * 从查询参数解析权重配置(优化目标、全局速度系数、等级限速覆盖)。
 *
 * @param query 查询参数对象(键名与 URL 查询串一致)。
 * @returns 合法配置的片段;非法或缺省的键不出现在结果里。
 * @remarks 非法值一律丢弃而不是报错——权重参数是展示型输入,宁可用默认值,
 * 也不该让一个手滑的查询串打断整个接口。`/api/stats` 与 `/api/path` 共用本函数,
 * 保证两条链路的权重口径完全一致。
 */
export function parseWeightProfileParams(query: Record<string, unknown>): Partial<WeightProfile> {
  const profile: Partial<WeightProfile> = {};
  const metric = query['metric'];
  if (metric === 'distance' || metric === 'time') profile.metric = metric;
  const speedFactor = parsePositiveNumber(query['speedFactor']);
  if (speedFactor !== undefined) profile.speedFactor = speedFactor;
  const speedOverridesKmh = parseSpeedOverrides(query['speedKmh']);
  if (speedOverridesKmh !== undefined) profile.speedOverridesKmh = speedOverridesKmh;
  return profile;
}

/**
 * 解析查询参数里的交通条件(Sprint 3 · issue #65;与 parseWeightProfileParams 同为收口入口)。
 *
 * 识别的键:
 * - `hour`:参考钟点(0–24,允许小数,如 8.5 = 08:30)。**传入即启用拥堵时间槽**,
 *   缺省不启用(与 Sprint 2 行为兼容);`congestion=off` 显式关闭拥堵、只保留事件。
 * - `events`:`on`(缺省)/`off`——off 时忽略服务端预置事件场景。
 *
 * @param query 查询参数对象。
 * @param presetEvents 服务端预置事件场景(插件选项传入)。
 * @returns 交通条件;未传钟点时返回 undefined(调用方按"无交通条件"处理,零行为变化)。
 * @remarks 非法值与权重参数同风格:丢弃/回退,不报错。
 */
export function parseTrafficParams(
  query: Record<string, unknown>,
  presetEvents?: readonly TrafficEvent[],
): TrafficConditions | undefined {
  const hourRaw = query['hour'];
  if (typeof hourRaw !== 'string' || hourRaw.trim() === '') return undefined;
  const hour = Number(hourRaw);
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) return undefined;

  const conditions: TrafficConditions = { hourOfDay: hour };
  if (isExplicitOff(query['congestion'])) {
    conditions.congestionDisabled = true;
  } else {
    conditions.congestion = normalizeCongestionProfile(undefined);
  }
  const eventsEnabled = !isExplicitOff(query['events']);
  if (eventsEnabled && presetEvents && presetEvents.length > 0) {
    conditions.events = presetEvents;
  }
  return conditions;
}

/** 查询串 → 可达性参数(合法端口径);origin 缺失或非法返回 null。 */
function parseAccessibilityParams(
  query: Record<string, unknown>,
  presetEvents?: readonly TrafficEvent[],
): {
  originNode: number;
  budgetMinutes: number;
  mode: TravelMode;
  profile: Partial<WeightProfile>;
  traffic: TrafficConditions | undefined;
} | null {
  const origin = Number(query['origin']);
  if (!Number.isInteger(origin) || origin < 0) return null;
  const budget = parsePositiveNumber(query['budget']) ?? 15;
  const modeRaw = query['mode'];
  const mode: TravelMode =
    modeRaw === 'walk' || modeRaw === 'bike' || modeRaw === 'bus' ? modeRaw : 'car';
  return {
    originNode: origin,
    budgetMinutes: Math.min(budget, 120),
    mode,
    profile: parseWeightProfileParams(query),
    traffic: parseTrafficParams(query, presetEvents),
  };
}

/** 等时圈响应:报告 + 口径说明(随响应下发,前端无需硬编码)。 */
type AccessibilityResponse = AccessibilityReport & {
  notes?: typeof ACCESSIBILITY_NOTES;
  error?: string;
};

/** 等时圈口径说明随响应下发,前端无需硬编码。 */
const ACCESSIBILITY_NOTES = {
  mileageUnit: '按边统计:两端均可达才计入里程(way 横跨可达边界会高估,边与 /api/stats 口径一致)',
  search: '限界 Dijkstra(预算早停),时间权重与 /api/path 同源(模态 + 配置 + 拥堵 + 事件)',
} as const;

/**
 * 注册 `/api/weights/profile`、`/api/weights/traffic`、`/api/stats` 与 `/api/accessibility`。
 * @param app Fastify 实例。
 * @param options 统计输入、可选拓扑指标与可选拟真事件场景。
 * @remarks 统计结果按配置缓存(上限 32),注册时预热默认配置;全量约 120 万条有向边,
 * 实时重算的排序与聚合成本不宜按每次请求承担。可达性结果按参数缓存(上限 16)。
 */
export async function registerWeightRoutes(
  app: FastifyInstance,
  options: WeightRoutesOptions,
): Promise<void> {
  const { network, topology, events } = options;

  const statsCache = new Map<string, NetworkStats>();
  const statsFor = (profile: WeightProfile, traffic?: TrafficConditions): NetworkStats => {
    const hourOfDay = traffic?.hourOfDay;
    const key = profileCacheKey(profile, hourOfDay);
    const cached = statsCache.get(key);
    if (cached !== undefined) return cached;
    const stats = computeNetworkStats(network, { profile, topology, traffic });
    if (statsCache.size >= STATS_CACHE_LIMIT) {
      const oldest = statsCache.keys().next().value;
      if (oldest !== undefined) statsCache.delete(oldest);
    }
    statsCache.set(key, stats);
    return stats;
  };

  const warmupStartedAt = performance.now();
  statsFor(DEFAULT_WEIGHT_PROFILE);
  app.log.info(`统计缓存预热完成: ${Math.round(performance.now() - warmupStartedAt)} ms`);

  // 可达性:邻接表与权重闭包按次构建 O(E),结果按参数缓存。
  const accessibilityCache = new Map<string, AccessibilityReport>();
  const accessibilityFor = (
    params: NonNullable<ReturnType<typeof parseAccessibilityParams>>,
  ): AccessibilityReport => {
    const key = JSON.stringify([
      params.originNode,
      params.budgetMinutes,
      params.mode,
      params.profile,
      params.traffic === undefined
        ? null
        : {
            hour: params.traffic.hourOfDay,
            congestionDisabled: params.traffic.congestionDisabled === true,
            eventCount: params.traffic.events?.length ?? 0,
          },
    ]);
    const cached = accessibilityCache.get(key);
    if (cached !== undefined) return cached;
    const report = computeAccessibility(network, params.originNode, params.budgetMinutes, {
      mode: params.mode,
      profile: normalizeWeightProfile(params.profile),
      traffic: params.traffic,
    }) ?? {
      // parseAccessibilityParams 已保证 origin 为非负整数;节点不存在时返回空报告而不是 500。
      originNode: params.originNode,
      budgetSeconds: params.budgetMinutes * 60,
      mode: params.mode,
      reachableNodeCount: 0,
      reachableEdgeCount: 0,
      reachableLengthMeters: 0,
      byHighway: [],
      truncated: false,
      profile: normalizeWeightProfile(params.profile),
      traffic: null,
    };
    if (accessibilityCache.size >= ACCESSIBILITY_CACHE_LIMIT) {
      const oldest = accessibilityCache.keys().next().value;
      if (oldest !== undefined) accessibilityCache.delete(oldest);
    }
    accessibilityCache.set(key, report);
    return report;
  };

  app.get('/api/weights/profile', (): WeightProfileResponse => ({
    default: DEFAULT_WEIGHT_PROFILE,
    speedTable: DEFAULT_SPEED_KMH,
  }));

  /** 拥堵与事件场景下发:前端面板与 E 的时间轴动画据此对齐(本地类型,契约草案见 issue)。 */
  app.get('/api/weights/traffic', () => ({
    congestion: DEFAULT_CONGESTION_PROFILE,
    events: events ?? [],
    notes: {
      composition:
        '有效速度 = (覆盖限速 ?? 模态默认限速) × 全局速度系数 ÷ 拥堵系数 × 事件乘子;拥堵系数乘在时间上(1=不拥堵),事件降速乘子乘在速度上;封闭 → 不可通行',
      determinism: '同一钟点与配置重复请求结果逐位相同(确定性模拟,无随机成分)',
    },
  }));

  app.get('/api/stats', (request): NetworkStats => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    return statsFor(
      normalizeWeightProfile(parseWeightProfileParams(query)),
      parseTrafficParams(query, events),
    );
  });

  app.get('/api/accessibility', (request, reply): AccessibilityResponse => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const params = parseAccessibilityParams(query, events);
    if (params === null) {
      void reply.code(400);
      return {
        originNode: -1,
        budgetSeconds: 0,
        mode: 'car',
        reachableNodeCount: 0,
        reachableEdgeCount: 0,
        reachableLengthMeters: 0,
        byHighway: [],
        truncated: false,
        profile: DEFAULT_WEIGHT_PROFILE,
        traffic: null,
        error: 'origin(起点节点 id,非负整数)为必填;budget(分钟,默认 15)可选',
      };
    }
    const report = accessibilityFor(params);
    if (!network.nodes.has(params.originNode)) void reply.code(404);
    return { ...report, notes: ACCESSIBILITY_NOTES };
  });
}

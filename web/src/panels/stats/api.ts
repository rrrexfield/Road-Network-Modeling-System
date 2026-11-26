/**
 * 统计接口访问层。
 * 服务端路由尚未注册时返回 null 而不是抛错,由面板决定降级到示例数据——
 * 这样 A 未注册插件之前,前端仍可独立开发与演示(见 D 的集成 issue)。
 */
import type { NetworkStats, WeightProfileResponse } from '../../charts/index.js';

const API_BASE = '/api';

/**
 * 拉取 JSON。
 *
 * 网络层失败(服务端尚未就绪)时**抛出**错误,让调用方重试;
 * 服务端已应答但状态码为错误时返回 null(接口确实不可用,重试无意义)。
 */
async function getJson<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/**
 * 拉取网络统计。
 * @param params.metric 优化目标;省略则用服务端默认值。必须透传——否则响应回显的
 * `profile.metric` 仍是服务端默认,前端面板的模式徽标会与实际选择不一致。
 * @param params.speedFactor 全局速度系数;省略则用服务端默认值。
 * @param params.speedOverridesKmh 等级限速覆盖表;省略或空表则不传参。
 * @returns 统计数据;接口不可用或返回错误状态时返回 null。
 */
export async function fetchStats(params?: {
  metric?: 'distance' | 'time';
  speedFactor?: number;
  speedOverridesKmh?: Record<string, number>;
  /** 参考钟点(0–24);传入即启用服务端拥堵时间槽(Sprint 3)。 */
  hour?: number;
  /** 显式关闭拥堵(congestion=off)。 */
  congestionOff?: boolean;
  /** 显式关闭事件场景(events=off)。 */
  eventsOff?: boolean;
}): Promise<NetworkStats | null> {
  const query = new URLSearchParams();
  if (params?.metric !== undefined) query.set('metric', params.metric);
  if (params?.speedFactor !== undefined) query.set('speedFactor', String(params.speedFactor));
  if (params?.hour !== undefined) query.set('hour', String(params.hour));
  if (params?.congestionOff === true) query.set('congestion', 'off');
  if (params?.eventsOff === true) query.set('events', 'off');
  const overrides = params?.speedOverridesKmh ?? {};
  const overridePairs = Object.entries(overrides);
  if (overridePairs.length > 0) {
    query.set('speedKmh', overridePairs.map(([highway, speed]) => `${highway}:${speed}`).join(','));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return getJson<NetworkStats>(`/stats${suffix}`);
}

/** 拉取权重基线配置(默认配置与各等级默认限速表)。 */
export async function fetchWeightProfile(): Promise<WeightProfileResponse | null> {
  return getJson<WeightProfileResponse>('/weights/profile');
}

/** 等时圈可达性报告(与服务端 AccessibilityReport 对齐的字段子集)。 */
export interface AccessibilityReportView {
  originNode: number;
  budgetSeconds: number;
  mode: string;
  reachableNodeCount: number;
  reachableEdgeCount: number;
  reachableLengthMeters: number;
  byHighway: Array<{
    highway: string;
    edgeCount: number;
    lengthMeters: number;
    lengthShare: number;
  }>;
  truncated: boolean;
}

/**
 * 拉取等时圈可达性统计(Sprint 3 · issue #65)。
 * @returns 报告;接口不可用、origin 非法(400)或起点未知(404)时返回 null。
 */
export async function fetchAccessibility(params: {
  originNode: number;
  budgetMinutes: number;
  mode: string;
  hour?: number;
  congestionOff?: boolean;
  eventsOff?: boolean;
}): Promise<AccessibilityReportView | null> {
  const query = new URLSearchParams();
  query.set('origin', String(params.originNode));
  query.set('budget', String(params.budgetMinutes));
  query.set('mode', params.mode);
  if (params.hour !== undefined) query.set('hour', String(params.hour));
  if (params.congestionOff === true) query.set('congestion', 'off');
  if (params.eventsOff === true) query.set('events', 'off');
  return getJson<AccessibilityReportView>(`/accessibility?${query.toString()}`);
}

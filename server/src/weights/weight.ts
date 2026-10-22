/**
 * 动态权重模型:把"边 → 代价"的计算封装为可注入 B 的 dijkstra 的纯函数闭包。
 * 本模块不反向依赖 io/topology,只消费节点坐标表与 way→等级表两张最简查找表。
 */
import type { RoadEdge } from '@gisalgo/shared';
import { haversineMeters } from './geo.js';
import { speedKmh, travelSeconds } from './speed.js';

/** 未收录等级在查找表中的占位名。 */
export const UNKNOWN_HIGHWAY = 'unknown';

/**
 * 边权函数:输入一条有向边,输出非负代价(数值越小越优先)。
 * 与 B 的 `server/src/graph/dijkstra.ts` 的 `EdgeWeightFn` 结构一致,并沿用其前置条件:
 * **返回值必须 ≥ 0 且有限**(负值破坏 Dijkstra 最优子结构,NaN/Infinity 会让边被静默跳过)。
 *
 * 本模块对"端点缺失"的边返回 `Infinity`(见 createDistanceWeight)。该分支在注入 B 的
 * `Graph` 时不会触发——`Graph.addEdge` 已校验端点存在,图内每条边两端都可解析;它只在
 * 图外场景(如统计直接遍历原始边集)出现。因此**在图内注入路径上本模块满足上述前置条件**;
 * 若 Sprint 3 把签名扩展为 `(edge, length) => number`,仍需沿此约束(见 issue #10)。
 *
 * TODO(契约): #14 同步区已记明 `EdgeWeightFn` 暂不冻结、Sprint 3 需 A/D/B 评审扩展
 * (当前签名不含边长);冻结到 shared 后本定义改为引用同一来源。
 */
export type EdgeWeightFn = (edge: RoadEdge) => number;

/** 权重与统计共用的网络上下文:两张查找表,不含任何实现依赖。 */
export interface NetworkContext {
  /** 节点 id → [lat, lon],与 loader / B 的 Graph 口径一致。 */
  nodes: ReadonlyMap<number, readonly [number, number]>;
  /** wayId → highway 等级;缺失按 UNKNOWN_HIGHWAY 处理。 */
  wayHighway: ReadonlyMap<number, string>;
}

/**
 * 权重配置。
 * Sprint 1 只包含"以什么为代价 + 等级限速 + 全局速度系数";Sprint 3 的拥堵/事件系数
 * 在此扩展为时间槽函数。
 */
export interface WeightProfile {
  /** 优化目标:distance = 里程最短(米),time = 用时最短(秒)。 */
  metric: 'distance' | 'time';
  /** 全局速度系数,>0;1 表示各等级按默认限速。仅 metric='time' 时影响结果。 */
  speedFactor: number;
  /** 等级 → 限速(km/h)覆盖表,优先于默认表。仅 metric='time' 时影响结果。 */
  speedOverridesKmh: Record<string, number>;
}

/** 默认权重配置:以用时最短为目标、不覆盖任何等级限速。 */
export const DEFAULT_WEIGHT_PROFILE: WeightProfile = {
  metric: 'time',
  speedFactor: 1,
  speedOverridesKmh: {},
};

/** 全局速度系数的允许上界,防止查询串输入把时间压到无意义的量级。 */
const MAX_SPEED_FACTOR = 3;

/**
 * 归一化外部输入的权重配置。
 * @param raw 可能缺字段或含非法值的输入(如查询串、前端面板)。
 * @returns 合法配置:metric 非 'distance'/'time' 时回退默认值;speedFactor 取
 * (0, MAX_SPEED_FACTOR] 内的有限正数,否则回退 1;限速覆盖只保留正有限值。
 * @remarks 复杂度 O(k),k 为覆盖表条目数。
 */
export function normalizeWeightProfile(raw: Partial<WeightProfile> | undefined): WeightProfile {
  const metric = raw?.metric;
  const factor = raw?.speedFactor;
  const speedFactor =
    typeof factor === 'number' && Number.isFinite(factor) && factor > 0
      ? Math.min(factor, MAX_SPEED_FACTOR)
      : DEFAULT_WEIGHT_PROFILE.speedFactor;

  const speedOverridesKmh: Record<string, number> = {};
  for (const [highway, speed] of Object.entries(raw?.speedOverridesKmh ?? {})) {
    if (typeof speed === 'number' && Number.isFinite(speed) && speed > 0) {
      speedOverridesKmh[highway] = speed;
    }
  }
  return {
    metric: metric === 'distance' || metric === 'time' ? metric : DEFAULT_WEIGHT_PROFILE.metric,
    speedFactor,
    speedOverridesKmh,
  };
}

/** 等级在给定配置下的有效限速(km/h):覆盖表 → 默认表 → 兜底,最后乘全局系数。 */
export function effectiveSpeedKmh(highway: string, profile: WeightProfile): number {
  const base = profile.speedOverridesKmh[highway] ?? speedKmh(highway);
  return base * profile.speedFactor;
}

/** 单条边的里程(米);任一端点缺失返回 null,由调用方决定如何降级。 */
function edgeLengthMeters(edge: RoadEdge, context: NetworkContext): number | null {
  const a = context.nodes.get(edge.from);
  const b = context.nodes.get(edge.to);
  if (a === undefined || b === undefined) return null;
  return haversineMeters(a, b);
}

/**
 * 距离权重:边权 = 球面里程(米)。
 * @param context 网络上下文(节点坐标表)。
 * @returns 可直接注入 B 的 dijkstra 的边权函数。
 * @remarks 按边 id 记忆化里程,同一网络下重复调用不重复做三角函数运算;端点缺失的边
 * 视为不可通行(Infinity),而不是 0——0 会让 Dijkstra 把缺失节点的边当作免费捷径。
 * 复杂度:首次 O(1)/边,命中缓存 O(1)。
 */
export function createDistanceWeight(context: NetworkContext): EdgeWeightFn {
  const lengthCache = new Map<number, number>();
  return (edge) => {
    const cached = lengthCache.get(edge.id);
    if (cached !== undefined) return cached;
    const length = edgeLengthMeters(edge, context) ?? Number.POSITIVE_INFINITY;
    lengthCache.set(edge.id, length);
    return length;
  };
}

/**
 * 按配置生成边权函数。
 * @param context 网络上下文(节点坐标表 + way→等级表)。
 * @param profile 权重配置;省略用 DEFAULT_WEIGHT_PROFILE。
 * @returns metric='distance' 时为里程(米)权重,metric='time' 时为时间(秒)权重。
 * @remarks 这是组装阶段唯一需要调用的入口:选目标、定限速,拿到可直接注入 B 的
 * dijkstra 的 EdgeWeightFn。复杂度同被选中的权重实现。
 */
export function createEdgeWeight(
  context: NetworkContext,
  profile: WeightProfile = DEFAULT_WEIGHT_PROFILE,
): EdgeWeightFn {
  return profile.metric === 'distance'
    ? createDistanceWeight(context)
    : createTimeWeight(context, profile);
}

/**
 * 时间权重:边权 = 里程 / 有效限速(秒)。
 * @param context 网络上下文(节点坐标表 + way→等级表)。
 * @param profile 权重配置;省略时用 DEFAULT_WEIGHT_PROFILE。
 * @returns 可直接注入 B 的 dijkstra 的边权函数。
 * @remarks 与 createDistanceWeight 共用里程,保证"里程最短"与"时间最短"的差异只来自限速;
 * 有效限速 ≤0 的边返回 Infinity。复杂度 O(1)/边(等级限速按等级记忆化)。
 */
export function createTimeWeight(
  context: NetworkContext,
  profile: WeightProfile = DEFAULT_WEIGHT_PROFILE,
): EdgeWeightFn {
  const lengthOf = createDistanceWeight(context);
  const speedCache = new Map<string, number>();
  return (edge) => {
    const highway = context.wayHighway.get(edge.wayId) ?? UNKNOWN_HIGHWAY;
    let speed = speedCache.get(highway);
    if (speed === undefined) {
      speed = effectiveSpeedKmh(highway, profile);
      speedCache.set(highway, speed);
    }
    return travelSeconds(lengthOf(edge), speed);
  };
}

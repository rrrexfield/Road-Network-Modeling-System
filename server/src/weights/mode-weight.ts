/**
 * 多模态权重模型(Sprint 2 · 作业二):按交通模态给出可注入 B 的 dijkstra 的边权函数,
 * 并为跨模态路径提供换乘罚时参数。
 *
 * 为什么模态不能共用汽车限速表:`/api/path?mode=walk` 当前走 `createEdgeWeight` +
 * `DEFAULT_WEIGHT_PROFILE`,即以汽车限速(fallback 30 km/h)计算步行时间——同一 1 km
 * 步行段会得到 2 分钟而不是真实的 ~13 分钟,跨模态路径的时间口径因此失真。
 * 本模块把"模态 → 速度"建模为独立查找表,模态间只共享里程。
 *
 * 与 weight.ts 的关系:car 模态直接委托 `createEdgeWeight`(既有汽车限速模型,零重复);
 * 其余模态复用同一里程缓存与时间换算,只替换速度来源。
 * 换乘罚时是"时间/成本口径"参数(契约 PathSegment 决策,issue #34):不计入
 * `PathResult.distance`,供跨模态搜索在模态切换边上加权使用。
 */
import type { TransferPoint, TravelMode } from '@gisalgo/shared';
import { FALLBACK_SPEED_KMH, speedKmh, travelSeconds } from './speed.js';
import {
  createDistanceWeight,
  createEdgeWeight,
  DEFAULT_WEIGHT_PROFILE,
  UNKNOWN_HIGHWAY,
  type EdgeWeightFn,
  type NetworkContext,
  type WeightProfile,
} from './weight.js';

/** 步行模态默认速度(km/h),按道路类型分档:台阶明显慢于平地,主干路沿线受过街干扰。 */
export const WALK_SPEED_KMH: Readonly<Record<string, number>> = {
  steps: 2,
  track: 4,
  primary: 4,
  secondary: 4,
  tertiary: 4,
};

/** 步行兜底速度(km/h):步行子图内的道路(footway/residential 等)按平地步速。 */
export const WALK_FALLBACK_SPEED_KMH = 4.5;

/** 骑行模态默认速度(km/h):专用道最快,与行人共享的道路显著减速,台阶按推行。 */
export const BIKE_SPEED_KMH: Readonly<Record<string, number>> = {
  cycleway: 18,
  living_street: 15,
  residential: 15,
  unclassified: 15,
  service: 12,
  tertiary: 14,
  secondary: 12,
  primary: 10,
  track: 8,
  path: 10,
  footway: 6,
  pedestrian: 6,
  steps: 2,
};

/** 骑行兜底速度(km/h)。 */
export const BIKE_FALLBACK_SPEED_KMH = 12;

/** 公交相对汽车限速的折减系数:公交在机动车道行驶,受停站与启停影响达不到限速。 */
export const BUS_SPEED_FACTOR = 0.8;

/** 公交通道(busway,公交专用道)速度(km/h):不受社会车辆限速约束,单独取值。 */
export const BUSWAY_SPEED_KMH = 20;

/**
 * 查模态默认速度(km/h)。
 * @param mode 交通模态。
 * @param highway OSM highway 等级。
 * @returns 模态下的默认速度;未收录等级回退到模态兜底值。
 * @remarks car 直接用汽车限速表;bus 在汽车限速上乘折减系数(busway 例外);
 * walk/bike 用模态独立表。复杂度 O(1)。
 */
export function modeSpeedKmh(mode: TravelMode, highway: string): number {
  switch (mode) {
    case 'car':
      return speedKmh(highway);
    case 'bus':
      if (highway === 'busway') return BUSWAY_SPEED_KMH;
      return speedKmh(highway) * BUS_SPEED_FACTOR;
    case 'walk':
      return WALK_SPEED_KMH[highway] ?? WALK_FALLBACK_SPEED_KMH;
    case 'bike':
      return BIKE_SPEED_KMH[highway] ?? BIKE_FALLBACK_SPEED_KMH;
  }
}

/**
 * 模态有效速度(km/h):等级覆盖表(与 WeightProfile.speedOverridesKmh 同源,
 * 允许面板按等级统一覆盖)优先于模态默认表,最后乘全局速度系数。
 * @remarks 保持与 effectiveSpeedKmh 相同的合成顺序,覆盖语义跨模态一致。复杂度 O(1)。
 */
export function effectiveModeSpeedKmh(
  mode: TravelMode,
  highway: string,
  profile: WeightProfile,
): number {
  const override = profile.speedOverridesKmh[highway];
  const base = override ?? modeSpeedKmh(mode, highway);
  return base * profile.speedFactor;
}

/**
 * 按模态生成边权函数,可直接注入 B 的 dijkstra / dijkstraWithTurnRestrictions。
 * @param context 网络上下文(节点坐标表 + way→等级表)。
 * @param mode 交通模态;car 等价于 `createEdgeWeight`(既有汽车模型)。
 * @param profile 权重配置;省略用 DEFAULT_WEIGHT_PROFILE。
 * @returns metric='distance' 时为里程(米)权重,metric='time' 时为按模态速度的时间(秒)权重。
 * @remarks 前置条件与 `EdgeWeightFn` 一致:返回值 ≥ 0 且有限(图内注入路径上成立);
 * 里程与 car 模态共用同一 Haversine 口径,保证跨模态比较时"距离"含义一致。
 * 复杂度 O(1)/边(速度按等级记忆化,里程按边记忆化)。
 */
export function createModeEdgeWeight(
  context: NetworkContext,
  mode: TravelMode,
  profile: WeightProfile = DEFAULT_WEIGHT_PROFILE,
): EdgeWeightFn {
  if (mode === 'car') return createEdgeWeight(context, profile);
  if (profile.metric === 'distance') return createDistanceWeight(context);

  const lengthOf = createDistanceWeight(context);
  const speedCache = new Map<string, number>();
  return (edge) => {
    const highway = context.wayHighway.get(edge.wayId) ?? UNKNOWN_HIGHWAY;
    let speed = speedCache.get(highway);
    if (speed === undefined) {
      speed = effectiveModeSpeedKmh(mode, highway, profile);
      speedCache.set(highway, speed);
    }
    return travelSeconds(lengthOf(edge), speed);
  };
}

/**
 * 换乘罚时(分钟),按转换点类型取值 = 等待时间 + 进出站步行冗余。
 *
 * ⚠️ 占位值:目前按城市公共交通换乘的常见经验取地铁 5 分、公交 3 分、停车 5 分,
 * 属于行业常用估计而非实测标定。真实标定依赖 C 的核验换乘连接(转换点逐模式出入口,
 * issue #34)与作业三的时间槽模拟,标定后由 D 更新本表并同步 AGENTS.md。
 */
export const TRANSFER_PENALTY_MINUTES: Record<TransferPoint['kind'], number> = {
  subway: 5,
  bus: 3,
  parking: 5,
};

/**
 * 查换乘罚时(秒)。
 * @param kind 转换点类型。
 * @returns 罚时(秒),正有限;直接加到跨模态搜索的时间代价上,不计入 PathResult.distance。
 * @remarks 复杂度 O(1)。
 */
export function transferPenaltySeconds(kind: TransferPoint['kind']): number {
  return TRANSFER_PENALTY_MINUTES[kind] * 60;
}

/** 模态兜底速度的集合,供测试与诊断枚举;car 的兜底即汽车表的 FALLBACK_SPEED_KMH。 */
export const MODE_FALLBACK_SPEED_KMH: Record<TravelMode, number> = {
  car: FALLBACK_SPEED_KMH,
  bus: FALLBACK_SPEED_KMH * BUS_SPEED_FACTOR,
  walk: WALK_FALLBACK_SPEED_KMH,
  bike: BIKE_FALLBACK_SPEED_KMH,
};

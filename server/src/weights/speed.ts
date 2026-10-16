/**
 * 道路等级限速模型:highway 等级 → 通行速度(km/h)。
 * 速度表是权重模块的参数基线,Sprint 3 的拥堵时间函数在其之上叠加(见 weight.ts)。
 * 等级集合与 shared 的 HIGHWAY_COLORS 对齐,新增等级须同时补齐两处。
 */

/** 未知等级的兜底限速(km/h)。 */
export const FALLBACK_SPEED_KMH = 30;

/**
 * highway 等级默认限速(km/h)。
 * 取值参考城市道路工程设计速度与 OSM 等级惯例,用于把里程换算成通行时间,
 * 表示"设计通行能力"而非实时路况。
 */
export const DEFAULT_SPEED_KMH: Readonly<Record<string, number>> = {
  motorway: 100,
  motorway_link: 60,
  trunk: 80,
  trunk_link: 50,
  primary: 60,
  primary_link: 40,
  secondary: 50,
  secondary_link: 35,
  tertiary: 40,
  tertiary_link: 30,
  residential: 30,
  unclassified: 30,
  road: 30,
  living_street: 15,
  service: 15,
  track: 20,
  cycleway: 15,
  pedestrian: 5,
  footway: 5,
  path: 5,
  steps: 3,
};

/**
 * 查等级默认限速。
 * @param highway OSM highway 等级;未收录时回退 FALLBACK_SPEED_KMH。
 * @returns 限速(km/h)。
 * @remarks 复杂度 O(1)。
 */
export function speedKmh(highway: string): number {
  return DEFAULT_SPEED_KMH[highway] ?? FALLBACK_SPEED_KMH;
}

/**
 * 里程换算通行时间。
 * @param distanceMeters 里程(米)。
 * @param speed 速度(km/h)。
 * @returns 通行时间(秒);速度非正时返回 Infinity,表示不可通行。
 * @remarks 返回 Infinity 而非抛错,便于直接参与最短路取最小运算。复杂度 O(1)。
 */
export function travelSeconds(distanceMeters: number, speed: number): number {
  if (!(speed > 0)) return Number.POSITIVE_INFINITY;
  return distanceMeters / ((speed * 1000) / 3600);
}

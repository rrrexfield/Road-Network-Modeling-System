/**
 * 距离度量:WGS84 球面 Haversine。
 * 与 server/src/graph(B)的默认边权采用同一公式与地球半径,避免"里程"与"时间"两条链路
 * 因半径取值不同而产生口径分歧。
 */

/** 地球平均半径(米)。与 B 的 dijkstra 默认边权取值一致。 */
export const EARTH_RADIUS_M = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * 两点球面大圆距离(Haversine)。
 * @param a 起点 [lat, lon](度)。
 * @param b 终点 [lat, lon](度)。
 * @returns 大圆距离(米);两点重合返回 0。
 * @remarks 对 sqrt 参数做 [0,1] 截断,避免浮点误差使 asin 返回 NaN;路网相邻节点(几十米
 * 量级)属短距离,球面近似误差可忽略。复杂度 O(1)。
 */
export function haversineMeters(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dLat = toRadians(b[0] - a[0]);
  const dLon = toRadians(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[0])) * Math.cos(toRadians(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

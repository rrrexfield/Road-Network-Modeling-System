import type { TurnKind } from '@gisalgo/shared';

type Coordinate = readonly [number, number];

/** 计算从 a 到 b 的球面初始方位角，单位为度，北为零、顺时针为正。 */
function bearing(a: Coordinate, b: Coordinate): number | null {
  const radians = Math.PI / 180;
  const lat1 = a[0] * radians;
  const lat2 = b[0] * radians;
  const delta = (b[1] - a[1]) * radians;
  const y = Math.sin(delta) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta);
  if (Math.hypot(x, y) < 1e-12) return null;
  return Math.atan2(y, x) / radians;
}

/**
 * 根据入口起点、路口、出口终点的 [lat,lon] 坐标计算转向展示量。
 * @returns 右正左负的角度（范围 (-180,180]）与分类；退化/非法几何返回 null。
 * @remarks 入口按驶向路口的方向计算。阈值为项目显示策略：≤20° 直行、≥160°
 * 掉头，45°–135° 为左右转，其余 ambiguous；不用于禁转算法判定。
 */
export function computeTurnGeometry(
  incomingStart: Coordinate,
  via: Coordinate,
  outgoingEnd: Coordinate,
): { angleDelta: number; turnKind: TurnKind } | null {
  for (const coordinate of [incomingStart, via, outgoingEnd]) {
    if (
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1]) ||
      Math.abs(coordinate[0]) > 90 ||
      Math.abs(coordinate[1]) > 180
    )
      return null;
  }
  const reverseIncoming = bearing(via, incomingStart);
  const outgoing = bearing(via, outgoingEnd);
  if (reverseIncoming === null || outgoing === null) return null;
  // 在路口求入口的到达方位，而不是长球面弧起点处的初始方位。
  const incoming = reverseIncoming + 180;
  let angleDelta = ((outgoing - incoming + 540) % 360) - 180;
  if (angleDelta === -180) angleDelta = 180;
  const absolute = Math.abs(angleDelta);
  let turnKind: TurnKind = 'ambiguous';
  if (absolute <= 20) turnKind = 'straight';
  else if (absolute >= 160) turnKind = 'u_turn';
  else if (absolute >= 45 && absolute <= 135) turnKind = angleDelta > 0 ? 'right' : 'left';
  return { angleDelta, turnKind };
}

import type { IntersectionTurns, TurnAction } from '@gisalgo/shared';

export interface RestrictionArc {
  key: string;
  path: [number, number][];
}

export type WayGeometryLookup = ReadonlyMap<number, readonly [number, number][]>;

export interface RestrictionArrow {
  key: string;
  path: [number, number][];
  /** 掉头只在目标道路臂上画红线，不生成箭头。 */
  arrowhead?: [number, number][];
}

interface LocalPoint {
  x: number;
  y: number;
}

interface ArmCandidate {
  position: [number, number];
  /** 从路口指向道路臂的方位角，北为 0、顺时针为正。 */
  bearing: number;
}

const EARTH_METERS_PER_DEGREE_LAT = 110_540;
const EARTH_METERS_PER_DEGREE_LON_AT_EQUATOR = 111_320;
const ARM_DISTANCE_METERS = 22;
const ARROWHEAD_SIZE_METERS = 11;
const INTERSECTION_TOLERANCE_METERS = 1.5;

function localPoint(center: [number, number], point: readonly [number, number]): LocalPoint {
  const lonScale = Math.cos((center[1] * Math.PI) / 180);
  return {
    x:
      (point[0] - center[0]) *
      EARTH_METERS_PER_DEGREE_LON_AT_EQUATOR *
      Math.max(1e-6, Math.abs(lonScale)),
    y: (point[1] - center[1]) * EARTH_METERS_PER_DEGREE_LAT,
  };
}

function worldPoint(center: [number, number], point: LocalPoint): [number, number] {
  const lonScale = Math.max(1e-6, Math.abs(Math.cos((center[1] * Math.PI) / 180)));
  return [
    center[0] + point.x / (EARTH_METERS_PER_DEGREE_LON_AT_EQUATOR * lonScale),
    center[1] + point.y / EARTH_METERS_PER_DEGREE_LAT,
  ];
}

function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}

function bearingDelta(from: number, to: number): number {
  let delta = normalizeBearing(to) - normalizeBearing(from);
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

function pointSegmentMetrics(
  point: LocalPoint,
  start: LocalPoint,
  end: LocalPoint,
): { distance: number; t: number; length: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { distance: Math.hypot(point.x - start.x, point.y - start.y), t: 0, length: 0 };
  }
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const nearest = { x: start.x + dx * t, y: start.y + dy * t };
  return {
    distance: Math.hypot(point.x - nearest.x, point.y - nearest.y),
    t,
    length: Math.sqrt(lengthSquared),
  };
}

/**
 * 从一条 Way 的完整折线中提取路口附近可选的道路臂。
 *
 * 同一条道路可能是双向的，也可能是 Way 的中间节点，因此不能从坐标顺序推断
 * “驶入”或“驶出”方向。这里保留路口两侧的候选点，后续用 TurnAction.angleDelta
 * 选择与转向语义最吻合的一对。
 */
function armCandidates(
  geometry: readonly [number, number][],
  center: [number, number],
): ArmCandidate[] {
  if (geometry.length < 2) return [];
  const centerLocal: LocalPoint = { x: 0, y: 0 };
  const candidates: ArmCandidate[] = [];

  const add = (point: LocalPoint): void => {
    const radius = Math.hypot(point.x, point.y);
    if (radius < 1) return;
    const bearing = normalizeBearing((Math.atan2(point.x, point.y) * 180) / Math.PI);
    const existing = candidates.find(
      (candidate) => Math.abs(bearingDelta(candidate.bearing, bearing)) < 2.5,
    );
    if (existing !== undefined) return;
    candidates.push({ position: worldPoint(center, point), bearing });
  };

  for (let index = 0; index < geometry.length - 1; index += 1) {
    const start = localPoint(center, geometry[index]!);
    const end = localPoint(center, geometry[index + 1]!);
    const metrics = pointSegmentMetrics(centerLocal, start, end);
    if (metrics.distance > INTERSECTION_TOLERANCE_METERS || metrics.length === 0) continue;

    const ux = (end.x - start.x) / metrics.length;
    const uy = (end.y - start.y) / metrics.length;
    const projection = {
      x: start.x + (end.x - start.x) * metrics.t,
      y: start.y + (end.y - start.y) * metrics.t,
    };

    for (const direction of [1, -1]) {
      const available =
        direction > 0 ? metrics.length * (1 - metrics.t) : metrics.length * metrics.t;
      if (available < 1) continue;
      const distance = Math.min(ARM_DISTANCE_METERS, available);
      add({
        x: projection.x + ux * direction * distance,
        y: projection.y + uy * direction * distance,
      });
    }
  }

  return candidates;
}

function chooseArmPair(
  fromArms: readonly ArmCandidate[],
  toArms: readonly ArmCandidate[],
  turn: TurnAction,
): { from: ArmCandidate; to: ArmCandidate } | null {
  let best: { from: ArmCandidate; to: ArmCandidate; score: number } | undefined;

  for (const from of fromArms) {
    // 入臂按驶向路口计算，出臂按离开路口计算。
    const incoming = normalizeBearing(from.bearing + 180);
    for (const to of toArms) {
      const delta = bearingDelta(incoming, to.bearing);
      const sameArm =
        Math.hypot(from.position[0] - to.position[0], from.position[1] - to.position[1]) < 1e-7;
      const score = Math.abs(bearingDelta(delta, turn.angleDelta));
      // 非掉头的正常转向应优先使用不同道路臂；该项只做极小权重破平。
      const tieBreak = sameArm && turn.turnKind !== 'u_turn' ? 0.25 : 0;
      if (best === undefined || score + tieBreak < best.score) {
        best = { from, to, score: score + tieBreak };
      }
    }
  }
  return best === undefined ? null : { from: best.from, to: best.to };
}

function quadraticPath(
  start: LocalPoint,
  control: LocalPoint,
  end: LocalPoint,
  steps = 14,
): LocalPoint[] {
  const path: LocalPoint[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const inverse = 1 - t;
    path.push({
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
    });
  }
  return path;
}

/** 掉头仅沿目标道路臂画短线，避免箭头尖端受地图缩放和定位误差影响而漂移。 */
function uTurnRoadLine(target: LocalPoint): LocalPoint[] {
  const radius = Math.hypot(target.x, target.y);
  if (radius < 1) return [];
  const ux = target.x / radius;
  const uy = target.y / radius;
  const start = Math.min(5, radius * 0.35);
  return [
    { x: ux * start, y: uy * start },
    { x: ux * radius, y: uy * radius },
  ];
}

function arrowhead(
  end: LocalPoint,
  previous: LocalPoint,
  size = ARROWHEAD_SIZE_METERS,
): LocalPoint[] {
  const dx = end.x - previous.x;
  const dy = end.y - previous.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  const ux = dx / length;
  const uy = dy / length;
  const base = { x: end.x - ux * size, y: end.y - uy * size };
  return [
    end,
    { x: base.x - uy * size * 0.55, y: base.y + ux * size * 0.55 },
    { x: base.x + uy * size * 0.55, y: base.y - ux * size * 0.55 },
  ];
}

/**
 * 根据道路几何和转向语义构建“驶入臂 → 被禁止的出臂”箭头。
 *
 * `angleDelta` 只用于在一条 Way 的两个几何臂之间选择正确方向，不再直接
 * 作为以路口为中心的抽象弧线角度。若某条道路几何缺失，返回结果中会跳过该
 * 动作，由图层使用旧弧线降级。
 */
export function buildRestrictionArrows(
  intersection: IntersectionTurns,
  wayGeometries: WayGeometryLookup,
): RestrictionArrow[] {
  const center = intersection.position;
  const centerLocal: LocalPoint = { x: 0, y: 0 };
  const arrows: RestrictionArrow[] = [];

  for (const turn of intersection.turns) {
    if (!turn.forbidden) continue;
    const fromGeometry = wayGeometries.get(turn.fromWayId);
    const toGeometry = wayGeometries.get(turn.toWayId);
    if (fromGeometry === undefined || toGeometry === undefined) continue;

    const pair = chooseArmPair(
      armCandidates(fromGeometry, center),
      armCandidates(toGeometry, center),
      turn,
    );
    if (pair === null) continue;

    const from = localPoint(center, pair.from.position);
    const to = localPoint(center, pair.to.position);
    if (turn.turnKind === 'u_turn') {
      const line = uTurnRoadLine(to);
      if (line.length < 2) continue;
      arrows.push({
        key: `${turn.fromEdge}:${turn.toEdge}`,
        path: line.map((point) => worldPoint(center, point)),
      });
      continue;
    }

    const path = quadraticPath(from, centerLocal, to);
    const end = path[path.length - 1];
    const previous = path[path.length - 2];
    if (end === undefined || previous === undefined) continue;
    const head = arrowhead(end, previous);
    if (head.length !== 3) continue;

    arrows.push({
      key: `${turn.fromEdge}:${turn.toEdge}`,
      path: path.map((point) => worldPoint(center, point)),
      arrowhead: head.map((point) => worldPoint(center, point)),
    });
  }

  return arrows;
}

/** 构建路口中心的红色示意弧线；精确边几何由后续契约扩展提供。 */
export function buildRestrictionArcs(intersection: IntersectionTurns): RestrictionArc[] {
  const [lon, lat] = intersection.position;
  const lonScale = Math.cos((lat * Math.PI) / 180);
  return intersection.turns
    .filter((turn) => turn.forbidden)
    .map((turn, index) => {
      const radius = 0.00018 + index * 0.000025;
      const delta = ((turn.angleDelta || 20) * Math.PI) / 180;
      const start = Math.PI / 2;
      const end = start - delta;
      const steps = Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / 12)));
      const path: [number, number][] = [];
      for (let step = 0; step <= steps; step += 1) {
        const angle = start + ((end - start) * step) / steps;
        path.push([lon + (Math.cos(angle) * radius) / lonScale, lat + Math.sin(angle) * radius]);
      }
      return { key: `${turn.fromEdge}:${turn.toEdge}`, path };
    });
}

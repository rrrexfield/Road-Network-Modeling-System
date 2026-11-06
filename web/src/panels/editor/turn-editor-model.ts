import type { NearestIntersectionResponse, TurnAction, TurnKind } from '@gisalgo/shared';

/** 拾取路口时的最大命中半径（米）。 */
export const PICK_MAX_DISTANCE_M = 15;

/** 允许拾取路口的最小地图缩放级别。 */
export const PICK_MIN_ZOOM = 15;

/**
 * 地图事件源的最小接口。
 *
 * MapLibre 的 `Map` 在结构上兼容该接口，因此宿主可以直接把真实地图传入；
 * 这里刻意不 import maplibre-gl，避免把运行时与类型耦合进面板模块。
 */
export interface MapLibreLike {
  on(event: 'click', cb: (event: { lngLat: { lng: number; lat: number } }) => void): void;
  off(event: 'click', cb: (event: { lngLat: { lng: number; lat: number } }) => void): void;
  getZoom(): number;
}

/** 路口属性摘要的一行。 */
export interface IntersectionSummaryField {
  label: string;
  value: string;
}

const TURN_LABELS: Record<TurnKind, string> = {
  left: '左转',
  right: '右转',
  straight: '直行',
  u_turn: '掉头',
  ambiguous: '模糊转向',
};

export interface TurnPair {
  fromEdge: number;
  toEdge: number;
}

export function turnKindLabel(kind: TurnKind): string {
  return TURN_LABELS[kind];
}

export function turnDescription(turn: TurnAction, roadName: (wayId: number) => string): string {
  const from = roadName(turn.fromWayId);
  const to = roadName(turn.toWayId);
  if (turn.turnKind === 'ambiguous') {
    const direction = turn.angleDelta >= 0 ? '右' : '左';
    return `${from} → ${to}（${direction}偏 ${Math.abs(turn.angleDelta).toFixed(0)}°）`;
  }
  return `${from} → ${to} · ${turnKindLabel(turn.turnKind)}`;
}

export function turnPairKey(pair: TurnPair): string {
  return `${pair.fromEdge}:${pair.toEdge}`;
}

export function forbiddenPairs(turns: TurnAction[]): TurnPair[] {
  return turns
    .filter((turn) => turn.forbidden)
    .map(({ fromEdge, toEdge }) => ({ fromEdge, toEdge }));
}

/**
 * 把拾取命中的路口信息整理成面板顶部展示的最小属性列表。
 *
 * 口径与 `NearestIntersectionResponse` 一致：degree 是当前模态下的关联道路数，
 * connectedWayIds 是相连的 Way ID 列表，roadNames 只含可解析路名。
 */
export function summarizeIntersection(
  info: NearestIntersectionResponse,
): IntersectionSummaryField[] {
  const wayCount = info.connectedWayIds.length;
  return [
    { label: '路口 Node', value: String(info.nodeId) },
    { label: '关联道路数', value: `${info.degree} 条` },
    {
      label: '相连 Way',
      value: wayCount === 0 ? '无' : `${wayCount} 个（${info.connectedWayIds.join('、')}）`,
    },
    {
      label: '路名',
      value: info.roadNames.length === 0 ? '无名道路' : info.roadNames.join('、'),
    },
  ];
}

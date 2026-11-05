import type { TurnAction, TurnKind } from '@gisalgo/shared';

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

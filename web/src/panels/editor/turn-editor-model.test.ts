import { describe, expect, it } from 'vitest';
import type { TurnAction } from '@gisalgo/shared';
import {
  forbiddenPairs,
  turnDescription,
  turnKindLabel,
  turnPairKey,
} from './turn-editor-model.js';

function turn(overrides: Partial<TurnAction> = {}): TurnAction {
  return {
    fromEdge: 10,
    toEdge: 20,
    fromWayId: 1,
    toWayId: 2,
    turnKind: 'left',
    angleDelta: -80,
    forbidden: false,
    fromOsm: false,
    ...overrides,
  };
}

describe('转向编辑器视图模型', () => {
  it('显示普通转向标签', () => {
    expect(turnKindLabel('u_turn')).toBe('掉头');
    expect(turnDescription(turn(), (id) => `道路${id}`)).toBe('道路1 → 道路2 · 左转');
  });

  it('模糊转向显示偏角，不伪造左右分类', () => {
    expect(
      turnDescription(turn({ turnKind: 'ambiguous', angleDelta: 75 }), (id) => `道路${id}`),
    ).toBe('道路1 → 道路2（右偏 75°）');
  });

  it('边对键和禁转集合只取边 ID', () => {
    expect(turnPairKey({ fromEdge: 3, toEdge: 4 })).toBe('3:4');
    expect(forbiddenPairs([turn({ forbidden: true }), turn({ toEdge: 30 })])).toEqual([
      { fromEdge: 10, toEdge: 20 },
    ]);
  });
});

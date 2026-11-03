import type { IntersectionTurns, TurnAction, TurnKind } from '@gisalgo/shared';
import { describe, expect, it } from 'vitest';
import { classifyTurnRestrictions } from './index';

function action(toEdge: number, turnKind: TurnKind, forbidden = true, fromEdge = 1): TurnAction {
  return {
    fromEdge,
    toEdge,
    turnKind,
    forbidden,
    fromWayId: 10,
    toWayId: 20,
    angleDelta: 0,
    fromOsm: false,
  };
}
const intersection = (turns: TurnAction[]): IntersectionTurns => ({
  nodeId: 100,
  position: [114, 30],
  turns,
});

describe('classifyTurnRestrictions', () => {
  it('四种被禁几何映射为普通禁转，并保留来源和当前图ID', () => {
    const input = intersection([
      action(2, 'left'),
      action(3, 'right'),
      action(4, 'straight'),
      { ...action(5, 'u_turn'), fromOsm: true },
    ]);
    const result = classifyTurnRestrictions(input, 50);
    expect(result.restrictions.map((r) => [r.id, r.type, r.source])).toEqual([
      [50, 'no_left_turn', 'manual'],
      [51, 'no_right_turn', 'manual'],
      [52, 'no_straight_on', 'manual'],
      [53, 'no_u_turn', 'osm'],
    ]);
    expect(result.restrictions.every((r) => r.viaNode === 100)).toBe(true);
  });

  it('仅一个直行动作允许时，为所有实际被禁边对标记only_straight_on', () => {
    const input = intersection([
      action(2, 'straight', false),
      action(3, 'left'),
      action(4, 'right'),
      action(5, 'ambiguous'),
      action(6, 'u_turn'),
    ]);
    const result = classifyTurnRestrictions(input);
    expect(result.restrictions.map((r) => [r.toEdge, r.type])).toEqual([
      [3, 'only_straight_on'],
      [4, 'only_straight_on'],
      [5, 'only_straight_on'],
      [6, 'only_straight_on'],
    ]);
    expect(result.unclassified).toEqual([]);
    expect(input.turns[0]!.forbidden).toBe(false);
  });

  it('入口分开判断，不把另一入口的禁左合并为仅直行', () => {
    const result = classifyTurnRestrictions(
      intersection([
        action(2, 'straight', false),
        action(3, 'left'),
        action(2, 'straight', false, 10),
        action(3, 'left', true, 10),
        action(4, 'right', false, 10),
      ]),
    );
    expect(result.restrictions.map((r) => [r.fromEdge, r.type])).toEqual([
      [1, 'only_straight_on'],
      [10, 'no_left_turn'],
    ]);
  });

  it('多个直行出口允许时不猜测唯一专用动作，未知被禁动作单列', () => {
    const result = classifyTurnRestrictions(
      intersection([
        action(2, 'straight', false),
        action(3, 'straight', false),
        action(4, 'ambiguous'),
      ]),
    );
    expect(result.restrictions).toEqual([]);
    expect(result.unclassified).toEqual([{ fromEdge: 1, toEdge: 4 }]);
  });

  it('没有禁转时不生成规则；全部禁转时不误称仅直行', () => {
    expect(
      classifyTurnRestrictions(intersection([action(2, 'straight', false)])).restrictions,
    ).toEqual([]);
    expect(
      classifyTurnRestrictions(intersection([action(2, 'straight')])).restrictions[0]?.type,
    ).toBe('no_straight_on');
  });

  it('拒绝重复动作及不安全的规则起始ID', () => {
    expect(() =>
      classifyTurnRestrictions(intersection([action(2, 'left'), action(2, 'left')])),
    ).toThrow('重复');
    expect(() => classifyTurnRestrictions(intersection([]), -1)).toThrow('安全整数');
  });
});

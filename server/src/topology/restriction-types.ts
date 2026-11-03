import type {
  IntersectionTurns,
  TurnAction,
  TurnRestriction,
  TurnRestrictionType,
} from '@gisalgo/shared';

/**
 * 根据完整路口清单为被禁边对生成语义类型，不改变禁转集合。
 * @param intersection IntersectionTurnIndex 返回的全部动作（不可传入过滤后的子集）。
 * @param firstId 本次结果的起始规则 ID，仅在当前图版本内有意义。
 * @returns 可分类的规则与无法分类的被禁边对，后者仍必须保留在稀疏禁转表中。
 * @remarks 按入口分组；仅剩一个允许动作且为直行、其余动作全部被禁时归并 only_straight_on。
 * 归并后的每条记录仍指向实际被禁止的边对，type 只作语义说明。复杂度 O(动作数)。
 */
export function classifyTurnRestrictions(
  intersection: IntersectionTurns,
  firstId = 0,
): {
  restrictions: TurnRestriction[];
  unclassified: { fromEdge: number; toEdge: number }[];
} {
  if (
    !Number.isSafeInteger(firstId) ||
    firstId < 0 ||
    firstId > Number.MAX_SAFE_INTEGER - intersection.turns.length
  ) {
    throw new Error('规则起始 ID 超出安全整数范围');
  }
  const groups = new Map<number, TurnAction[]>();
  const pairs = new Set<string>();
  for (const action of intersection.turns) {
    const key = `${action.fromEdge}:${action.toEdge}`;
    if (pairs.has(key)) throw new Error(`重复转向动作: ${key}`);
    pairs.add(key);
    const group = groups.get(action.fromEdge) ?? [];
    group.push(action);
    groups.set(action.fromEdge, group);
  }
  const restrictions: TurnRestriction[] = [];
  const unclassified: { fromEdge: number; toEdge: number }[] = [];
  const ordinary: Partial<Record<TurnAction['turnKind'], TurnRestrictionType>> = {
    left: 'no_left_turn',
    right: 'no_right_turn',
    u_turn: 'no_u_turn',
    straight: 'no_straight_on',
  };
  for (const group of groups.values()) {
    const allowed = group.filter((action) => !action.forbidden);
    const onlyStraight =
      group.some((action) => action.forbidden) &&
      allowed.length === 1 &&
      allowed[0]!.turnKind === 'straight';
    for (const action of group) {
      if (!action.forbidden) continue;
      const type = onlyStraight ? 'only_straight_on' : ordinary[action.turnKind];
      if (type === undefined) {
        unclassified.push({ fromEdge: action.fromEdge, toEdge: action.toEdge });
        continue;
      }
      restrictions.push({
        id: firstId + restrictions.length,
        viaNode: intersection.nodeId,
        fromEdge: action.fromEdge,
        toEdge: action.toEdge,
        type,
        source: action.fromOsm ? 'osm' : 'manual',
      });
    }
  }
  return { restrictions, unclassified };
}

import type { RoadEdge } from '@gisalgo/shared';
import { describe, expect, it } from 'vitest';
import { IntersectionTurnIndex } from './index';

function fixture(five = false) {
  const nodes = new Map<number, [number, number]>([
    [0, [0, 0]],
    [1, [-1, 0]],
    [2, [0, 1]],
    [3, [1, 0]],
    [4, [0, -1]],
  ]);
  if (five) nodes.set(5, [1, 0.57735]);
  const edges: RoadEdge[] = [];
  for (const id of nodes.keys()) {
    if (id === 0) continue;
    edges.push({ id: id * 2, from: id, to: 0, wayId: id * 100 });
    edges.push({ id: id * 2 + 1, from: 0, to: id, wayId: id * 100 });
  }
  return { nodes, edges, index: new IntersectionTurnIndex(nodes, edges) };
}

describe('IntersectionTurnIndex', () => {
  it('四路口枚举16个边对，入口南侧包含四种转向且来源正确', () => {
    const { index } = fixture();
    const intersection = index.getTurns(0);
    expect(intersection.position).toEqual([0, 0]);
    expect(intersection.turns).toHaveLength(16);
    expect(
      intersection.turns.filter((t) => t.fromEdge === 2).map((t) => [t.toEdge, t.turnKind]),
    ).toEqual([
      [3, 'u_turn'],
      [5, 'right'],
      [7, 'straight'],
      [9, 'left'],
    ]);
    expect(intersection.turns.find((t) => t.fromEdge === 2 && t.toEdge === 5)).toMatchObject({
      fromWayId: 100,
      toWayId: 200,
      angleDelta: 90,
      forbidden: false,
      fromOsm: false,
    });
  });

  it('合成五路口枚举25个动作并包含ambiguous，不冒充武汉固定用例', () => {
    const { index } = fixture(true);
    const turns = index.getTurns(0).turns;
    expect(turns).toHaveLength(25);
    expect(turns.find((t) => t.fromEdge === 2 && t.toEdge === 11)?.turnKind).toBe('ambiguous');
    expect(new Set(turns.map((t) => `${t.fromEdge}:${t.toEdge}`)).size).toBe(25);
  });

  it('禁转更新在枚举中即时生效，其他入口不受影响', () => {
    const { index } = fixture();
    index.restrictions.replace(0, { forbidden: [{ fromEdge: 2, toEdge: 9 }] });
    expect(
      index
        .getTurns(0)
        .turns.filter((t) => t.forbidden)
        .map((t) => [t.fromEdge, t.toEdge]),
    ).toEqual([[2, 9]]);
    index.restrictions.replace(0, { forbidden: [] });
    expect(index.getTurns(0).turns.every((t) => !t.forbidden)).toBe(true);
  });

  it('无入边/出边的节点没有转向；不存在节点明确报错', () => {
    const { index } = fixture();
    expect(index.getTurns(1).turns).toHaveLength(1);
    expect(() => index.getTurns(999)).toThrow('路口不存在');
    expect(new IntersectionTurnIndex(new Map([[8, [30, 114]]]), []).getTurns(8)).toEqual({
      nodeId: 8,
      position: [114, 30],
      turns: [],
    });
  });

  it('零长度几何明确定位到边对，不能伪装成可显示角度', () => {
    const { nodes, edges } = fixture();
    nodes.set(1, [0, 0]);
    expect(() => new IntersectionTurnIndex(nodes, edges).getTurns(0)).toThrow(
      '转向几何无法判定: 2 → 3 @ 0',
    );
  });

  it('构造时拒绝缺失端点', () => {
    expect(
      () => new IntersectionTurnIndex(new Map(), [{ id: 1, from: 1, to: 2, wayId: 10 }]),
    ).toThrow('缺失边端点');
  });

  it('返回位置按lon/lat排列，返回值变化不会改写索引', () => {
    const nodes = new Map<number, [number, number]>([
      [1, [30, 114]],
      [2, [30, 114.1]],
      [3, [30.1, 114.1]],
    ]);
    const index = new IntersectionTurnIndex(nodes, [
      { id: 1, from: 1, to: 2, wayId: 10 },
      { id: 2, from: 2, to: 3, wayId: 20 },
    ]);
    const first = index.getTurns(2);
    expect(first.position).toEqual([114.1, 30]);
    first.position[0] = 0;
    first.turns[0]!.forbidden = true;
    expect(index.getTurns(2).position).toEqual([114.1, 30]);
    expect(index.getTurns(2).turns[0]!.forbidden).toBe(false);
  });
});

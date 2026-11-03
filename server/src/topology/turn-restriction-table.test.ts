import { describe, expect, it } from 'vitest';
import { TurnRestrictionTable } from './index';

const edges = [
  { id: 1, from: 10, to: 20, wayId: 100 },
  { id: 2, from: 30, to: 20, wayId: 200 },
  { id: 3, from: 20, to: 40, wayId: 300 },
  { id: 4, from: 20, to: 50, wayId: 400 },
];

describe('TurnRestrictionTable', () => {
  it('仅禁止指定入口到出口，不影响同路口其他转向', () => {
    const table = new TurnRestrictionTable(edges);
    expect(table.isForbidden(20, 1, 3)).toBe(false);
    expect(table.replace(20, { forbidden: [{ fromEdge: 1, toEdge: 3 }] })).toBe(1);
    expect(table.isForbidden(20, 1, 3)).toBe(true);
    expect(table.isForbidden(20, 2, 3)).toBe(false);
    expect(table.isForbidden(20, 1, 4)).toBe(false);
    expect(table.isForbidden(99, 1, 3)).toBe(false);
  });

  it('重复边对去重，覆盖不累积，空集合清除', () => {
    const table = new TurnRestrictionTable(edges);
    const pair = { fromEdge: 1, toEdge: 3 };
    expect(table.replace(20, { forbidden: [pair, pair] })).toBe(1);
    table.replace(20, { forbidden: [{ fromEdge: 2, toEdge: 4 }] });
    expect(table.isForbidden(20, 1, 3)).toBe(false);
    expect(table.isForbidden(20, 2, 4)).toBe(true);
    expect(table.replace(20, { forbidden: [] })).toBe(0);
    expect(table.isForbidden(20, 2, 4)).toBe(false);
  });

  it.each([
    { fromEdge: 99, toEdge: 3 },
    { fromEdge: 3, toEdge: 1 },
  ])('无效边对整体拒绝并保留旧集合：%j', (invalid) => {
    const table = new TurnRestrictionTable(edges);
    table.replace(20, { forbidden: [{ fromEdge: 1, toEdge: 3 }] });
    expect(() => table.replace(20, { forbidden: [{ fromEdge: 2, toEdge: 4 }, invalid] })).toThrow();
    expect(table.isForbidden(20, 1, 3)).toBe(true);
    expect(table.isForbidden(20, 2, 4)).toBe(false);
  });

  it('重复边 ID 拒绝装载', () => {
    expect(() => new TurnRestrictionTable([edges[0]!, edges[0]!])).toThrow('重复边 ID');
  });
});

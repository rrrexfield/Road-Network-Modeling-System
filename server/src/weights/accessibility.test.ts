import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { computeAccessibility, type AccessibilityInput } from './accessibility.js';
import { DEFAULT_WEIGHT_PROFILE } from './weight.js';

/** 线性测试路网:5 节点一字排开,每段约 1112 m(0.01° 经差 @lat30),primary 限速 60 km/h。 */
function makeInput(
  overrides?: Partial<{
    closedWay: number;
    incidentWay: number;
  }>,
): AccessibilityInput & { edges: RoadEdge[] } {
  const nodes = new Map<number, readonly [number, number]>(
    [1, 2, 3, 4, 5].map((id) => [id, [30, 114 + (id - 1) * 0.01] as const]),
  );
  const wayHighway = new Map<number, string>([
    [10, 'primary'],
    [20, 'residential'],
  ]);
  const edges: RoadEdge[] = [
    { id: 0, from: 1, to: 2, wayId: 10 },
    { id: 1, from: 2, to: 1, wayId: 10 },
    { id: 2, from: 2, to: 3, wayId: 10 },
    { id: 3, from: 3, to: 2, wayId: 10 },
    { id: 4, from: 3, to: 4, wayId: 20 },
    { id: 5, from: 4, to: 3, wayId: 20 },
    { id: 6, from: 4, to: 5, wayId: 20 },
    { id: 7, from: 5, to: 4, wayId: 20 },
  ];
  return { nodes, edges, wayHighway, ...overrides };
}

/** 每段约 963 m(0.01° 经差 @lat30)@60km/h ≈ 57.8 s;@residential 30km/h ≈ 115.6 s。 */
describe('computeAccessibility(等时圈)', () => {
  it('预算内逐段可达:节点数/边数/里程与预算一致', () => {
    const input = makeInput();
    // 预算 70 s:只够 1→2(66.7s),不够 1→3
    const report = computeAccessibility(input, 1, 70 / 60);
    expect(report).not.toBeNull();
    expect(report!.originNode).toBe(1);
    expect(report!.reachableNodeCount).toBe(2);
    expect(report!.reachableEdgeCount).toBe(2); // 边 0/1 两端均可达
    expect(report!.reachableLengthMeters).toBeGreaterThan(1900);
    expect(report!.reachableLengthMeters).toBeLessThan(1960);
    expect(report!.truncated).toBe(false);
  });

  it('预算收紧,可达集合随之收缩;预算放宽覆盖全网', () => {
    const input = makeInput();
    const tight = computeAccessibility(input, 1, 0.5); // 30 s:到不了 2(66.7s)
    expect(tight!.reachableNodeCount).toBe(1);
    expect(tight!.reachableEdgeCount).toBe(0);
    const full = computeAccessibility(input, 1, 10); // 10 分钟 ≫ 全网约 9×57.8s
    expect(full!.reachableNodeCount).toBe(5);
    expect(full!.reachableEdgeCount).toBe(8);
    const primary = full!.byHighway.find((row) => row.highway === 'primary')!;
    expect(primary.lengthShare).toBeCloseTo(0.5, 6); // primary/residential 各 4 条等长边
  });

  it('封闭事件阻断唯一通路:绕行不存在时可达集合收缩', () => {
    const input = makeInput();
    const base = computeAccessibility(input, 1, 10)!;
    expect(base.reachableNodeCount).toBe(5);
    // primary(way 10)封闭:1 与 2/3 断开,4/5 也失去经由 3 的通路
    const closed = computeAccessibility(input, 1, 10, {
      traffic: {
        hourOfDay: 12,
        events: [{ wayIds: [10], kind: 'closure' }],
      },
    })!;
    expect(closed.reachableNodeCount).toBe(1);
    expect(closed.reachableEdgeCount).toBe(0);
    expect(closed.traffic).toEqual({
      hourOfDay: 12,
      congestionEnabled: true,
      appliedEventCount: 1,
    });
    // 拥堵默认启用(未显式关闭)只影响时间半径,不影响"封闭断网"的结论
  });

  it('事故降速改变等时圈半径:同一预算下可达边减少', () => {
    const input = makeInput();
    const normal = computeAccessibility(input, 1, 2)!; // 120 s
    expect(normal.reachableNodeCount).toBeGreaterThanOrEqual(3); // 1,2,3
    // 全网事故降速 ×0.4:120 s 只够跑 0.4 倍距离
    const incident = computeAccessibility(input, 1, 2, {
      traffic: {
        hourOfDay: 12,
        events: [{ wayIds: [10, 20], kind: 'incident', speedFactor: 0.4 }],
      },
    })!;
    expect(incident.reachableNodeCount).toBeLessThan(normal.reachableNodeCount);
  });

  it('拥堵时间槽:早高峰同一预算可达节点少于夜间', () => {
    const input = makeInput();
    const peak = computeAccessibility(input, 1, 1, { traffic: { hourOfDay: 8.5 } })!;
    const night = computeAccessibility(input, 1, 1, { traffic: { hourOfDay: 3 } })!;
    expect(peak.reachableNodeCount).toBeLessThanOrEqual(night.reachableNodeCount);
  });

  it('未传交通条件时 traffic 为 null,与 /api/path 默认口径一致', () => {
    const report = computeAccessibility(makeInput(), 1, 5)!;
    expect(report.traffic).toBeNull();
    expect(report.profile).toEqual(DEFAULT_WEIGHT_PROFILE);
  });

  it('确定性:同一输入两次运行结果逐位相同', () => {
    const input = makeInput();
    const a = computeAccessibility(input, 1, 5, { traffic: { hourOfDay: 8.5 } })!;
    const b = computeAccessibility(input, 1, 5, { traffic: { hourOfDay: 8.5 } })!;
    expect(a).toEqual(b);
  });

  it('起点不存在返回 null;非正预算回退 15 分钟', () => {
    const input = makeInput();
    expect(computeAccessibility(input, 99, 5)).toBeNull();
    const fallback = computeAccessibility(input, 1, -1)!;
    expect(fallback.budgetSeconds).toBe(900);
  });

  it('mode=walk 用步速:同一预算可达范围更小', () => {
    const input = makeInput();
    const car = computeAccessibility(input, 1, 1, { mode: 'car' })!;
    const walk = computeAccessibility(input, 1, 1, { mode: 'walk' })!;
    expect(walk.reachableNodeCount).toBeLessThanOrEqual(car.reachableNodeCount);
    expect(walk.mode).toBe('walk');
  });
});

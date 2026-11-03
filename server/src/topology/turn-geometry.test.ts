import { describe, expect, it } from 'vitest';
import { computeTurnGeometry } from './index';

describe('computeTurnGeometry', () => {
  it.each([
    { end: [1, 0], kind: 'straight', angle: 0 },
    { end: [0, 1], kind: 'right', angle: 90 },
    { end: [0, -1], kind: 'left', angle: -90 },
    { end: [-1, 0], kind: 'u_turn', angle: 180 },
  ] as const)('从南向北进入，出口 $end 为 $kind', ({ end, kind, angle }) => {
    const result = computeTurnGeometry([-1, 0], [0, 0], end);
    expect(result?.turnKind).toBe(kind);
    expect(result?.angleDelta).toBeCloseTo(angle, 6);
  });

  it('近北方向穿过角度零点时仍为小角度直行', () => {
    const result = computeTurnGeometry([-1, 0.01], [0, 0], [1, 0.01]);
    expect(result?.turnKind).toBe('straight');
    expect(Math.abs(result!.angleDelta)).toBeLessThan(2);
  });

  it('五路口的斜向出口可回退为 ambiguous，并保留实际偏角', () => {
    const result = computeTurnGeometry([-1, 0], [0, 0], [1, 0.57735]);
    expect(result?.turnKind).toBe('ambiguous');
    expect(result?.angleDelta).toBeCloseTo(30, 1);
  });

  it('反向来路会改变左右分类，不能将转向作为节点级属性', () => {
    expect(computeTurnGeometry([1, 0], [0, 0], [0, 1])?.turnKind).toBe('left');
    expect(computeTurnGeometry([-1, 0], [0, 0], [0, 1])?.turnKind).toBe('right');
  });

  it('跨日期变更线使用短方向，不把经度差当平面方位', () => {
    const result = computeTurnGeometry([0, 179], [0, -180], [0, -179]);
    expect(result?.turnKind).toBe('straight');
    expect(result?.angleDelta).toBeCloseTo(0, 6);
  });

  it('重复坐标无法决定来向或去向，不输出假直行', () => {
    expect(computeTurnGeometry([0, 0], [0, 0], [1, 0])).toBeNull();
    expect(computeTurnGeometry([-1, 0], [0, 0], [0, 0])).toBeNull();
  });

  it('非法或对跖几何不输出角度', () => {
    expect(computeTurnGeometry([NaN, 0], [0, 0], [1, 0])).toBeNull();
    expect(computeTurnGeometry([-1, 0], [91, 0], [1, 0])).toBeNull();
    expect(computeTurnGeometry([0, 180], [0, 0], [1, 0])).toBeNull();
  });
});

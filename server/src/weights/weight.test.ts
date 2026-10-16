import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { haversineMeters } from './geo.js';
import {
  DEFAULT_WEIGHT_PROFILE,
  UNKNOWN_HIGHWAY,
  createDistanceWeight,
  createEdgeWeight,
  createTimeWeight,
  effectiveSpeedKmh,
  normalizeWeightProfile,
  type NetworkContext,
} from './weight.js';

const A: readonly [number, number] = [30, 114];
const B: readonly [number, number] = [30, 114.001];
const C: readonly [number, number] = [30, 114.002];

const context: NetworkContext = {
  nodes: new Map<number, readonly [number, number]>([
    [1, A],
    [2, B],
    [3, C],
  ]),
  wayHighway: new Map<number, string>([
    [100, 'primary'],
    [200, 'motorway'],
  ]),
};

const edge = (id: number, from: number, to: number, wayId: number): RoadEdge => ({
  id,
  from,
  to,
  wayId,
});

/** 1→2,primary,约 96.3 米。 */
const primaryEdge = edge(1, 1, 2, 100);
/** 2→3,motorway。 */
const motorwayEdge = edge(2, 2, 3, 200);
/** 终点不在坐标表内。 */
const orphanEdge = edge(3, 1, 99, 100);
/** wayId 未收录等级。 */
const unknownHighwayEdge = edge(4, 1, 2, 999);

const metersPerSecond = (kmh: number): number => (kmh * 1000) / 3600;

describe('createDistanceWeight', () => {
  it('边权等于两端点球面里程', () => {
    const weight = createDistanceWeight(context);
    expect(weight(primaryEdge)).toBeCloseTo(haversineMeters(A, B), 6);
    expect(weight(motorwayEdge)).toBeCloseTo(haversineMeters(B, C), 6);
  });

  it('端点缺失的边不可通行,不按 0 米计入', () => {
    expect(createDistanceWeight(context)(orphanEdge)).toBe(Number.POSITIVE_INFINITY);
  });

  it('重复调用结果稳定', () => {
    const weight = createDistanceWeight(context);
    expect(weight(primaryEdge)).toBe(weight(primaryEdge));
  });

  it('不同网络上下文各自独立,互不串值', () => {
    const shifted: NetworkContext = {
      nodes: new Map<number, readonly [number, number]>([
        [1, [30, 114]],
        [2, [30, 115]],
      ]),
      wayHighway: context.wayHighway,
    };
    expect(createDistanceWeight(shifted)(primaryEdge)).not.toBeCloseTo(
      createDistanceWeight(context)(primaryEdge),
      6,
    );
  });
});

describe('createTimeWeight', () => {
  it('时间权重 = 里程 / 等级默认限速', () => {
    const time = createTimeWeight(context);
    expect(time(primaryEdge)).toBeCloseTo(haversineMeters(A, B) / metersPerSecond(60), 6);
    expect(time(motorwayEdge)).toBeCloseTo(haversineMeters(B, C) / metersPerSecond(100), 6);
  });

  it('与距离权重同源:时间 × 速度还原里程', () => {
    const distance = createDistanceWeight(context)(primaryEdge);
    const seconds = createTimeWeight(context)(primaryEdge);
    expect(seconds * metersPerSecond(60)).toBeCloseTo(distance, 6);
  });

  it('全局速度系数放大后耗时同比缩短', () => {
    const base = createTimeWeight(context)(primaryEdge);
    const faster = createTimeWeight(context, {
      metric: 'time',
      speedFactor: 2,
      speedOverridesKmh: {},
    })(primaryEdge);
    expect(faster).toBeCloseTo(base / 2, 6);
  });

  it('等级限速覆盖表优先于默认表', () => {
    const overridden = createTimeWeight(context, {
      metric: 'time',
      speedFactor: 1,
      speedOverridesKmh: { primary: 120 },
    })(primaryEdge);
    expect(overridden).toBeCloseTo(haversineMeters(A, B) / metersPerSecond(120), 6);
  });

  it('未收录等级按兜底限速计时', () => {
    const time = createTimeWeight(context);
    expect(time(unknownHighwayEdge)).toBeCloseTo(haversineMeters(A, B) / metersPerSecond(30), 6);
  });

  it('端点缺失的边不可通行', () => {
    expect(createTimeWeight(context)(orphanEdge)).toBe(Number.POSITIVE_INFINITY);
  });

  it('默认配置不改动各等级限速', () => {
    expect(createTimeWeight(context)).toBeTypeOf('function');
    expect(effectiveSpeedKmh('primary', DEFAULT_WEIGHT_PROFILE)).toBe(60);
  });
});

describe('effectiveSpeedKmh', () => {
  it('覆盖表优先、再乘全局系数', () => {
    expect(
      effectiveSpeedKmh('primary', {
        metric: 'time',
        speedFactor: 1.5,
        speedOverridesKmh: { primary: 40 },
      }),
    ).toBeCloseTo(60, 9);
  });

  it('未收录等级走兜底限速', () => {
    expect(effectiveSpeedKmh('bus_guideway', DEFAULT_WEIGHT_PROFILE)).toBe(30);
  });
});

describe('normalizeWeightProfile', () => {
  it('缺省输入得到默认配置', () => {
    expect(normalizeWeightProfile(undefined)).toEqual(DEFAULT_WEIGHT_PROFILE);
    expect(normalizeWeightProfile({})).toEqual(DEFAULT_WEIGHT_PROFILE);
  });

  it('非法速度系数回退默认值', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeWeightProfile({ speedFactor: bad }).speedFactor).toBe(1);
    }
  });

  it('速度系数被截断到上界', () => {
    expect(normalizeWeightProfile({ speedFactor: 99 }).speedFactor).toBe(3);
    expect(normalizeWeightProfile({ speedFactor: 2.5 }).speedFactor).toBe(2.5);
  });

  it('丢弃非正与非有限的限速覆盖项', () => {
    const profile = normalizeWeightProfile({
      speedOverridesKmh: { primary: 45, secondary: 0, tertiary: Number.NaN, service: -8 },
    });
    expect(profile.speedOverridesKmh).toEqual({ primary: 45 });
  });

  it('非法的优化目标回退默认值', () => {
    expect(normalizeWeightProfile({ metric: 'fastest' as 'time' }).metric).toBe('time');
    expect(normalizeWeightProfile({ metric: 'distance' }).metric).toBe('distance');
  });

  it('返回全新对象,不共享默认配置引用', () => {
    const profile = normalizeWeightProfile(undefined);
    profile.speedOverridesKmh['primary'] = 1;
    expect(DEFAULT_WEIGHT_PROFILE.speedOverridesKmh).toEqual({});
  });
});

describe('UNKNOWN_HIGHWAY', () => {
  it('用于无等级信息的 way 占位,且不出现在默认速度表中', () => {
    expect(UNKNOWN_HIGHWAY).toBe('unknown');
  });
});

describe('createEdgeWeight', () => {
  it('metric=distance 时按里程计权,速度系数不参与', () => {
    const weight = createEdgeWeight(context, {
      metric: 'distance',
      speedFactor: 3,
      speedOverridesKmh: { primary: 5 },
    });
    expect(weight(primaryEdge)).toBeCloseTo(haversineMeters(A, B), 6);
  });

  it('metric=time 时按时间计权', () => {
    const weight = createEdgeWeight(context, DEFAULT_WEIGHT_PROFILE);
    expect(weight(primaryEdge)).toBeCloseTo(haversineMeters(A, B) / metersPerSecond(60), 6);
  });
});

/**
 * B 的 `EdgeWeightFn` 前置条件:返回值必须 ≥ 0 且有限(负值破坏最优子结构,
 * NaN/Infinity 会让边被静默跳过)。Graph.addEdge 已校验端点存在,因此图内每条边
 * 两端都可解析——以下断言正是"注入 Graph 时"的成立条件。
 */
describe('EdgeWeightFn 与 B 的 dijkstra 前置条件', () => {
  /** 图内边:端点均已在坐标表中。 */
  const graphEdges = [primaryEdge, motorwayEdge, unknownHighwayEdge];

  for (const metric of ['distance', 'time'] as const) {
    it(`metric=${metric} 时图内边的代价均 ≥0 且有限`, () => {
      const weight = createEdgeWeight(context, { ...DEFAULT_WEIGHT_PROFILE, metric });
      for (const e of graphEdges) {
        const cost = weight(e);
        expect(Number.isFinite(cost)).toBe(true);
        expect(cost).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('极端限速下仍为有限值,不产生 NaN', () => {
    // 极小限速会把时间推到极大,但必须保持有限;NaN 会破坏 B 的优先队列堆序
    const weight = createTimeWeight(context, {
      metric: 'time',
      speedFactor: 0.0001,
      speedOverridesKmh: {},
    });
    const cost = weight(primaryEdge);
    expect(Number.isFinite(cost)).toBe(true);
    expect(Number.isNaN(cost)).toBe(false);
  });

  it('图外边(端点缺失)返回 Infinity,由 B 侧视为不可通行而不参与松弛', () => {
    // 这是有意的设计:0 会让 Dijkstra 把缺节点的边当作免费捷径。
    // 该分支只在图外场景(如统计遍历原始边集)出现,不违反图内注入的前置条件。
    expect(createEdgeWeight(context, DEFAULT_WEIGHT_PROFILE)(orphanEdge)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

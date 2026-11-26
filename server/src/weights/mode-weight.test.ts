import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { haversineMeters } from './geo.js';
import { speedKmh } from './speed.js';
import {
  createDistanceWeight,
  createEdgeWeight,
  DEFAULT_WEIGHT_PROFILE,
  normalizeWeightProfile,
  type NetworkContext,
} from './weight.js';
import {
  BIKE_FALLBACK_SPEED_KMH,
  BUS_SPEED_FACTOR,
  BUSWAY_SPEED_KMH,
  createModeEdgeWeight,
  effectiveModeSpeedKmh,
  MODE_FALLBACK_SPEED_KMH,
  modeSpeedKmh,
  transferPenaltySeconds,
  TRANSFER_PENALTY_MINUTES,
  WALK_FALLBACK_SPEED_KMH,
  WALK_SPEED_KMH,
} from './mode-weight.js';
import { congestionFactorAt as _cf, normalizeCongestionProfile } from './traffic.js';

const A: readonly [number, number] = [30, 114];
const B: readonly [number, number] = [30, 114.001];

const context: NetworkContext = {
  nodes: new Map<number, readonly [number, number]>([
    [1, A],
    [2, B],
  ]),
  wayHighway: new Map<number, string>([
    [100, 'primary'],
    [200, 'footway'],
    [300, 'cycleway'],
    [400, 'busway'],
  ]),
};

const edge = (id: number, from: number, to: number, wayId: number): RoadEdge => ({
  id,
  from,
  to,
  wayId,
});

/** 1→2,约 96.3 米。 */
const edgeOn = (wayId: number): RoadEdge => edge(1, 1, 2, wayId);
const primaryEdge = edgeOn(100);
const footwayEdge = edgeOn(200);
const cyclewayEdge = edgeOn(300);
const buswayEdge = edgeOn(400);
/** 终点不在坐标表内。 */
const orphanEdge = edge(9, 1, 99, 200);

const metersPerSecond = (kmh: number): number => (kmh * 1000) / 3600;

describe('modeSpeedKmh', () => {
  it('car 直接取汽车限速表', () => {
    expect(modeSpeedKmh('car', 'primary')).toBe(speedKmh('primary'));
  });

  it('walk 平地道路按步速,台阶明显更慢', () => {
    expect(modeSpeedKmh('walk', 'footway')).toBe(WALK_FALLBACK_SPEED_KMH);
    expect(modeSpeedKmh('walk', 'steps')).toBeLessThan(WALK_FALLBACK_SPEED_KMH);
  });

  it('bike 专用道最快,未收录等级回退模态兜底', () => {
    expect(modeSpeedKmh('bike', 'cycleway')).toBe(18);
    expect(modeSpeedKmh('bike', 'unmapped-level')).toBe(BIKE_FALLBACK_SPEED_KMH);
  });

  it('bus 在汽车限速上折减,busway 按专用道速度', () => {
    expect(modeSpeedKmh('bus', 'primary')).toBeCloseTo(speedKmh('primary') * BUS_SPEED_FACTOR, 10);
    expect(modeSpeedKmh('bus', 'busway')).toBe(BUSWAY_SPEED_KMH);
  });

  it('各模态兜底值均为正有限,不会产生 0 速边', () => {
    for (const fallback of Object.values(MODE_FALLBACK_SPEED_KMH)) {
      expect(fallback).toBeGreaterThan(0);
      expect(Number.isFinite(fallback)).toBe(true);
    }
  });
});

describe('effectiveModeSpeedKmh', () => {
  it('等级覆盖表优先于模态默认表,再乘全局系数', () => {
    const profile = normalizeWeightProfile({
      metric: 'time',
      speedFactor: 1.2,
      speedOverridesKmh: { footway: 3 },
    });
    expect(effectiveModeSpeedKmh('walk', 'footway', profile)).toBeCloseTo(3 * 1.2, 10);
    expect(effectiveModeSpeedKmh('walk', 'residential', profile)).toBeCloseTo(
      WALK_FALLBACK_SPEED_KMH * 1.2,
      10,
    );
  });

  it('覆盖合成顺序与汽车模型的 effectiveSpeedKmh 一致', () => {
    const profile = normalizeWeightProfile({
      speedFactor: 0.5,
      speedOverridesKmh: { primary: 20 },
    });
    expect(effectiveModeSpeedKmh('car', 'primary', profile)).toBe(10);
  });
});

describe('createModeEdgeWeight', () => {
  it('car 模态与既有 createEdgeWeight 逐边一致(时间口径)', () => {
    const modeWeight = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE);
    const baseWeight = createEdgeWeight(context, DEFAULT_WEIGHT_PROFILE);
    expect(modeWeight(primaryEdge)).toBe(baseWeight(primaryEdge));
    expect(modeWeight(footwayEdge)).toBe(baseWeight(footwayEdge));
  });

  it('distance 口径下各模态权重等于里程,与速度无关', () => {
    const distance = createDistanceWeight(context);
    for (const mode of ['walk', 'bike', 'bus'] as const) {
      const weight = createModeEdgeWeight(context, mode, {
        ...DEFAULT_WEIGHT_PROFILE,
        metric: 'distance',
      });
      expect(weight(cyclewayEdge)).toBeCloseTo(haversineMeters(A, B), 6);
      expect(weight(cyclewayEdge)).toBe(distance(cyclewayEdge));
    }
  });

  it('walk 时间权重按步速换算:450 米步道 ≈ 6 分钟', () => {
    // 96.3 米 / 4.5 km/h ≈ 77 秒;换 450 米夹具验证换算公式
    const long: NetworkContext = {
      nodes: new Map<number, readonly [number, number]>([
        [1, A],
        [2, [30, 114.005]],
      ]),
      wayHighway: new Map([[200, 'footway']]),
    };
    const length = haversineMeters(A, [30, 114.005]);
    const weight = createModeEdgeWeight(long, 'walk');
    expect(weight(edgeOn(200))).toBeCloseTo(length / metersPerSecond(WALK_FALLBACK_SPEED_KMH), 6);
  });

  it('同一里程的步行时间显著大于汽车时间(模态差异真实存在)', () => {
    const walk = createModeEdgeWeight(context, 'walk');
    const car = createModeEdgeWeight(context, 'car');
    expect(walk(footwayEdge)).toBeGreaterThan(car(footwayEdge));
  });

  it('bike / bus 按各自速度表换算时间', () => {
    const length = haversineMeters(A, B);
    const bike = createModeEdgeWeight(context, 'bike');
    expect(bike(cyclewayEdge)).toBeCloseTo(length / metersPerSecond(18), 6);
    const bus = createModeEdgeWeight(context, 'bus');
    expect(bus(buswayEdge)).toBeCloseTo(length / metersPerSecond(BUSWAY_SPEED_KMH), 6);
  });

  it('端点缺失的边不可通行(Infinity),与汽车模型口径一致', () => {
    const walk = createModeEdgeWeight(context, 'walk');
    expect(walk(orphanEdge)).toBe(Number.POSITIVE_INFINITY);
  });

  it('重复调用结果稳定(速度与里程记忆化不串值)', () => {
    const walk = createModeEdgeWeight(context, 'walk');
    expect(walk(footwayEdge)).toBe(walk(footwayEdge));
    expect(walk(primaryEdge)).not.toBe(walk(footwayEdge));
  });
});

describe('transferPenaltySeconds', () => {
  it('按转换点类型返回分钟 × 60 的秒数', () => {
    expect(transferPenaltySeconds('subway')).toBe(TRANSFER_PENALTY_MINUTES.subway * 60);
    expect(transferPenaltySeconds('bus')).toBe(TRANSFER_PENALTY_MINUTES.bus * 60);
    expect(transferPenaltySeconds('parking')).toBe(TRANSFER_PENALTY_MINUTES.parking * 60);
  });

  it('全部罚时为正有限,可直接参与时间代价累加', () => {
    for (const seconds of Object.values(TRANSFER_PENALTY_MINUTES)) {
      expect(seconds).toBeGreaterThan(0);
      expect(Number.isFinite(seconds)).toBe(true);
    }
  });
});

describe('createModeEdgeWeight · 拥堵与事件(Sprint 3 · issue #65)', () => {
  /** primary 限速 60 km/h;1→2 约 96.3 m → 无拥堵时间 ≈ 5.78 s。 */
  const baseSeconds = haversineMeters(A, B) / ((60 * 1000) / 3600);

  it('无交通条件时与 Sprint 2 行为逐位一致(零回归)', () => {
    const withTraffic = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE);
    const baseline = createEdgeWeight(context, DEFAULT_WEIGHT_PROFILE);
    expect(withTraffic(primaryEdge)).toBe(baseline(primaryEdge));
    expect(withTraffic(edge(2, 2, 1, 300))).toBe(
      createEdgeWeight(context, DEFAULT_WEIGHT_PROFILE)(edge(2, 2, 1, 300)),
    );
  });

  it('早高峰拥堵系数 >1 时时间变长,且与 congestionFactorAt 精确吻合(合成顺序=乘在速度上)', () => {
    const traffic = { hourOfDay: 8.5 };
    const factor = _cf(normalizeCongestionProfile(undefined), 8.5, 'primary');
    const expected = haversineMeters(A, B) / (((60 / factor) * 1000) / 3600); // 时间 = 基础时间 × 拥堵系数
    const weight = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE, traffic);
    expect(weight(primaryEdge)).toBeCloseTo(expected, 10);
    expect(weight(primaryEdge)).toBeGreaterThan(baseSeconds);
  });

  it('夜间畅通系数 <1 时时间变短', () => {
    const weight = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE, {
      hourOfDay: 3,
    });
    expect(weight(primaryEdge)).toBeLessThan(baseSeconds);
  });

  it('确定性:同一钟点两次构造结果逐位相同', () => {
    const a = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE, { hourOfDay: 8.5 });
    const b = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE, { hourOfDay: 8.5 });
    expect(a(primaryEdge)).toBe(b(primaryEdge));
  });

  it('closure 事件:time 口径返回 Infinity(不可通行)', () => {
    const weight = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE, {
      hourOfDay: 12,
      events: [{ wayIds: [100], kind: 'closure' }],
    });
    expect(weight(primaryEdge)).toBe(Number.POSITIVE_INFINITY);
  });

  it('closure 事件同样作用于 distance 口径;incident 降速不影响 distance', () => {
    const distance = haversineMeters(A, B);
    const closed = createModeEdgeWeight(
      context,
      'car',
      { ...DEFAULT_WEIGHT_PROFILE, metric: 'distance' },
      { hourOfDay: 12, events: [{ wayIds: [100], kind: 'closure' }] },
    );
    const incident = createModeEdgeWeight(
      context,
      'car',
      { ...DEFAULT_WEIGHT_PROFILE, metric: 'distance' },
      { hourOfDay: 12, events: [{ wayIds: [100], kind: 'incident', speedFactor: 0.3 }] },
    );
    expect(closed(primaryEdge)).toBe(Number.POSITIVE_INFINITY);
    expect(incident(primaryEdge)).toBe(distance);
  });

  it('incident 降速:time 口径按乘子精确放缓', () => {
    const weight = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE, {
      hourOfDay: 12,
      congestionDisabled: true,
      events: [{ wayIds: [100], kind: 'incident', speedFactor: 0.5 }],
    });
    expect(weight(primaryEdge)).toBeCloseTo(baseSeconds * 2, 10);
  });

  it('activeHours 窗口外事件不生效', () => {
    const weight = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE, {
      hourOfDay: 12,
      congestionDisabled: true,
      events: [{ wayIds: [100], kind: 'closure', activeHours: [7, 9] }],
    });
    expect(weight(primaryEdge)).toBe(baseSeconds);
  });

  it('可通行边的前置条件:返回值 ≥ 0 且有限', () => {
    const weight = createModeEdgeWeight(context, 'car', DEFAULT_WEIGHT_PROFILE, {
      hourOfDay: 8.5,
      events: [{ wayIds: [200], kind: 'incident', speedFactor: 0.2 }],
    });
    for (const e of [primaryEdge, edge(2, 1, 2, 200), edge(3, 1, 2, 300), edge(4, 1, 2, 400)]) {
      const value = weight(e);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('walk 模态 + 拥堵:在模态速度之上乘拥堵系数', () => {
    const walkBase = haversineMeters(A, B) / ((WALK_SPEED_KMH['primary']! * 1000) / 3600);
    const factor = _cf(normalizeCongestionProfile(undefined), 8.5, 'primary');
    const weight = createModeEdgeWeight(context, 'walk', DEFAULT_WEIGHT_PROFILE, {
      hourOfDay: 8.5,
    });
    expect(weight(edge(5, 1, 2, 100))).toBeCloseTo(walkBase * factor, 10);
  });
});

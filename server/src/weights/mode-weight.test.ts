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
} from './mode-weight.js';

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

import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { haversineMeters } from './geo.js';
import {
  computeNetworkStats,
  toTopologyMetrics,
  type StatsInput,
  type TopologyMetricsSource,
} from './stats.js';

const N1: readonly [number, number] = [30, 114];
const N2: readonly [number, number] = [30, 114.001];
const N3: readonly [number, number] = [30.0005, 114];
const N4: readonly [number, number] = [30.005, 114];
const N5: readonly [number, number] = [30.02, 114];

const edge = (id: number, from: number, to: number, wayId: number): RoadEdge => ({
  id,
  from,
  to,
  wayId,
});

/**
 * 4 条边长分处 50–100 / 100–200 / 500–1000 / ≥1000 米四档,外加一条端点缺失的边。
 * way 300 不登记等级,用于覆盖 unknown 分支。
 */
const input: StatsInput = {
  nodes: new Map<number, readonly [number, number]>([
    [1, N1],
    [2, N2],
    [3, N3],
    [4, N4],
    [5, N5],
  ]),
  edges: [
    edge(1, 1, 2, 100),
    edge(2, 2, 3, 100),
    edge(3, 3, 4, 200),
    edge(4, 4, 5, 300),
    edge(90, 6, 7, 100),
  ],
  wayHighway: new Map<number, string>([
    [100, 'primary'],
    [200, 'motorway'],
  ]),
};

const len12 = haversineMeters(N1, N2);
const len23 = haversineMeters(N2, N3);
const len34 = haversineMeters(N3, N4);
const len45 = haversineMeters(N4, N5);
const expectedTotal = len12 + len23 + len34 + len45;

describe('computeNetworkStats', () => {
  it('端点缺失的边整体跳过,不计入里程与计数', () => {
    const stats = computeNetworkStats(input);
    expect(stats.edgeCount).toBe(4);
    expect(stats.nodeCount).toBe(5);
    expect(stats.totalLengthMeters).toBeCloseTo(expectedTotal, 6);
  });

  it('里程与时间按等级聚合,占比之和为 1', () => {
    const stats = computeNetworkStats(input);
    expect(stats.wayCount).toBe(3);
    expect(stats.byHighway.map((row) => row.highway)).toEqual(['unknown', 'motorway', 'primary']);

    const primary = stats.byHighway.find((row) => row.highway === 'primary')!;
    expect(primary.edgeCount).toBe(2);
    expect(primary.lengthMeters).toBeCloseTo(len12 + len23, 6);

    const unknown = stats.byHighway.find((row) => row.highway === 'unknown')!;
    expect(unknown.lengthMeters).toBeCloseTo(len45, 6);

    const shareSum = stats.byHighway.reduce((sum, row) => sum + row.lengthShare, 0);
    expect(shareSum).toBeCloseTo(1, 9);
  });

  it('等级平均速度还原为默认限速', () => {
    const stats = computeNetworkStats(input);
    const speedOf = (highway: string): number =>
      stats.byHighway.find((row) => row.highway === highway)!.averageSpeedKmh;
    expect(speedOf('primary')).toBeCloseTo(60, 6);
    expect(speedOf('motorway')).toBeCloseTo(100, 6);
    expect(speedOf('unknown')).toBeCloseTo(30, 6);
  });

  it('总通行时间等于各等级时间之和', () => {
    const stats = computeNetworkStats(input);
    const sum = stats.byHighway.reduce((total, row) => total + row.travelSeconds, 0);
    expect(stats.totalTravelSeconds).toBeCloseTo(sum, 6);
  });

  it('全局速度系数放大后总时间缩短、平均速度提高', () => {
    const base = computeNetworkStats(input);
    const fast = computeNetworkStats(input, {
      profile: { metric: 'time', speedFactor: 2, speedOverridesKmh: {} },
    });
    expect(fast.totalTravelSeconds).toBeCloseTo(base.totalTravelSeconds / 2, 6);
    expect(fast.profile.speedFactor).toBe(2);
  });

  it('极值、均值与中位数落在正确区间', () => {
    const stats = computeNetworkStats(input);
    expect(stats.minEdgeMeters).toBeCloseTo(len12, 6);
    expect(stats.maxEdgeMeters).toBeCloseTo(len45, 6);
    expect(stats.meanEdgeMeters).toBeCloseTo(expectedTotal / 4, 6);
    expect(stats.medianEdgeMeters).toBeCloseTo((len23 + len34) / 2, 6);
    expect(stats.minEdgeMeters).toBeLessThan(stats.medianEdgeMeters);
    expect(stats.medianEdgeMeters).toBeLessThan(stats.maxEdgeMeters);
  });

  it('边长直方图分档完整且各边只落一档', () => {
    const stats = computeNetworkStats(input);
    expect(stats.lengthHistogram.map((bucket) => bucket.label)).toEqual([
      '0–20 m',
      '20–50 m',
      '50–100 m',
      '100–200 m',
      '200–500 m',
      '500–1000 m',
      '≥1000 m',
    ]);
    expect(stats.lengthHistogram.map((bucket) => bucket.edgeCount)).toEqual([0, 0, 1, 1, 0, 1, 1]);
    const counted = stats.lengthHistogram.reduce((sum, bucket) => sum + bucket.edgeCount, 0);
    expect(counted).toBe(stats.edgeCount);
  });

  it('拓扑指标未接入时显式标注 pending,而不是填零', () => {
    const stats = computeNetworkStats(input);
    expect(stats.topology).toBeNull();
    expect(stats.topologySource).toBe('pending');
  });

  it('接入拓扑指标后转为可序列化数组并标注来源', () => {
    const source: TopologyMetricsSource = {
      nodeCount: 5,
      edgeCount: 4,
      connectedComponentCount: 1,
      largestComponentSize: 5,
      danglingNodeCount: 2,
      isolatedNodeCount: 0,
      averageDegree: 1.6,
      degreeDistribution: new Map<number, number>([
        [2, 3],
        [1, 2],
      ]),
    };
    const stats = computeNetworkStats(input, { topology: source });
    expect(stats.topologySource).toBe('server/src/graph(graph-engine)');
    expect(stats.topology?.degreeDistribution).toEqual([
      { degree: 1, count: 2 },
      { degree: 2, count: 3 },
    ]);
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
  });

  it('空边集返回全零而非 NaN', () => {
    const stats = computeNetworkStats({ ...input, edges: [] });
    expect(stats.edgeCount).toBe(0);
    expect(stats.totalLengthMeters).toBe(0);
    expect(stats.meanEdgeMeters).toBe(0);
    expect(stats.medianEdgeMeters).toBe(0);
    expect(stats.byHighway).toEqual([]);
    expect(Number.isNaN(stats.totalTravelSeconds)).toBe(false);
  });

  it('默认权重配置为"用时最短"且不改动等级限速', () => {
    const stats = computeNetworkStats(input);
    expect(stats.profile).toEqual({ metric: 'time', speedFactor: 1, speedOverridesKmh: {} });
  });
});

describe('toTopologyMetrics', () => {
  it('度分布按键升序展开为数组', () => {
    const metrics = toTopologyMetrics({
      nodeCount: 3,
      edgeCount: 2,
      connectedComponentCount: 1,
      largestComponentSize: 3,
      danglingNodeCount: 2,
      isolatedNodeCount: 0,
      averageDegree: 1.33,
      degreeDistribution: new Map<number, number>([
        [3, 1],
        [1, 2],
      ]),
    });
    expect(metrics.degreeDistribution).toEqual([
      { degree: 1, count: 2 },
      { degree: 3, count: 1 },
    ]);
  });
});

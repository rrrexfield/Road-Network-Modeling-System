import { describe, expect, it } from 'vitest';
import type { TransferPointData } from '../io/index';
import { matchTransferConnections } from './index';

function data(): TransferPointData {
  return {
    points: [{ id: 2, kind: 'parking', position: [114, 30] }],
    sources: [
      {
        pointId: 2,
        sourceType: 'node',
        sourceId: 1,
        modes: ['car', 'walk'],
        positionMethod: 'osm-node',
      },
    ],
    issues: [],
  };
}
const nodes = (...rows: [number, [number, number]][]) => new Map(rows);
describe('matchTransferConnections', () => {
  it('三个近等距点的歧义判断不随迭代顺序改变', () => {
    const d = data();
    d.points[0]!.position = [0, 0];
    const rows: [number, [number, number]][] = [5, 5 - 0.6e-6, 5 - 1.2e-6].map((meters, index) => [
      index + 8,
      [meters / 111194.92664455874, 0],
    ]);
    for (const order of [rows, [...rows].reverse(), [rows[1]!, rows[0]!, rows[2]!]]) {
      const report = matchTransferConnections(d, { car: nodes(...order) }, 10);
      expect(report.matches).toEqual([]);
      expect(report.unresolved[0]?.reason).toBe('ambiguous-nearest');
    }
  });
  it('经度边界环绕仍能找到近邻', () => {
    const d = data();
    d.points[0]!.position = [179.99999, 0];
    const report = matchTransferConnections(d, { car: nodes([9, [0, -179.99999]]) }, 5);
    expect(report.matches[0]?.nodeId).toBe(9);
    expect(report.matches[0]?.distanceM).toBeLessThan(3);
  });

  it('极区搜索退回节点扫描，不因网格范围过大丢失候选', () => {
    const d = data();
    d.points[0]!.position = [0, 89.99999];
    const report = matchTransferConnections(d, { car: nodes([9, [89.99999, 90]]) }, 10);
    expect(report.matches[0]?.nodeId).toBe(9);
    expect(report.matches[0]?.distanceM).toBeLessThan(2);
  });

  it('选择真正最近点，不按网格内插入顺序选择', () => {
    const report = matchTransferConnections(data(), {
      car: nodes([8, [30.0003, 114]], [9, [30.0001, 114]]),
    });
    expect(report.matches[0]?.nodeId).toBe(9);
  });

  it('相同OSM节点只记录共享证据，不生成换乘边', () => {
    const graph = nodes([1, [30, 114]]);
    const report = matchTransferConnections(data(), { car: graph, walk: graph });
    expect(report.matches).toHaveLength(2);
    expect(report.matches.every((m) => m.evidence === 'shared-osm-node')).toBe(true);
    expect(report.unresolved).toEqual([]);
  });
  it('相同坐标不同ID仍是候选，不能当成已连通', () => {
    const report = matchTransferConnections(data(), { car: nodes([9, [30, 114]]) });
    expect(report.matches[0]).toMatchObject({
      nodeId: 9,
      distanceM: 0,
      evidence: 'nearby-candidate',
    });
    expect(report.unresolved[0]?.reason).toBe('mode-not-loaded');
  });
  it('跨网格边界找近邻，但半径外节点不吸附', () => {
    const report = matchTransferConnections(
      data(),
      { car: nodes([9, [29.99999, 113.99999]]), walk: nodes([8, [31, 115]]) },
      10,
    );
    expect(report.matches[0]?.distanceM).toBeLessThan(2);
    expect(report.unresolved[0]?.reason).toBe('no-node-within-radius');
  });
  it('区域中心要求真实出入口，不搜索附近道路', () => {
    const d = data();
    d.sources[0]!.sourceType = 'way';
    d.sources[0]!.positionMethod = 'bounding-box-center';
    expect(matchTransferConnections(d, { car: nodes([1, [30, 114]]) })).toEqual({
      matches: [],
      unresolved: [{ pointId: 2, reason: 'entrance-required' }],
    });
  });
  it('同ID坐标变化明确报告，避免复用旧数据', () => {
    const report = matchTransferConnections(data(), { car: nodes([1, [30.1, 114]]) });
    expect(report.matches).toEqual([]);
    expect(report.unresolved[0]?.reason).toBe('source-geometry-changed');
  });
  it('等距候选不任意挑选，非法半径拒绝', () => {
    expect(
      matchTransferConnections(data(), { car: nodes([8, [30, 114]], [9, [30, 114]]) }).unresolved[0]
        ?.reason,
    ).toBe('ambiguous-nearest');
    expect(() => matchTransferConnections(data(), {}, -1)).toThrow('半径');
  });
  it('缺失来源记录不猜测源节点ID', () => {
    const d = data();
    d.sources = [];
    expect(matchTransferConnections(d, {}).unresolved[0]?.reason).toBe('missing-source');
  });
});

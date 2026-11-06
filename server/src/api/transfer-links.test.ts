import { describe, expect, it } from 'vitest';
import type { TransferPointData } from '../io/index.js';
import { haversineMeters } from '../weights/index.js';
import { buildTransferLinks, summarizeTransferLinks } from './transfer-links.js';

/* ---------- 夹具 ---------- */

/** 停车点(1)与公交点(5)的坐标;其余为各模态路网上的节点。 */
const PARKING = [30.5, 114.3] as const;
const BUS_STOP = [30.5, 114.31] as const;

/** 公交站旁的公交路网节点(距站点约 18 m)与步行路网节点(站点自身)。 */
const BUS_NODE = [30.5, 114.31018] as const;
const BUS_STOP_NODE = [30.5, 114.31] as const;

const DATA: TransferPointData = {
  points: [
    { id: 100, kind: 'parking', position: [PARKING[1], PARKING[0]] },
    { id: 200, kind: 'bus', position: [BUS_STOP[1], BUS_STOP[0]] },
    // way 型设施(包围盒中心),缺出入口证据,不应产生任何连接
    { id: 300, kind: 'parking', position: [114.32, 30.5] },
  ],
  sources: [
    {
      pointId: 100,
      sourceType: 'node',
      sourceId: 1,
      modes: ['car', 'walk'],
      positionMethod: 'osm-node',
    },
    {
      pointId: 200,
      sourceType: 'node',
      sourceId: 5,
      modes: ['bus', 'walk'],
      positionMethod: 'osm-node',
    },
    {
      pointId: 300,
      sourceType: 'way',
      sourceId: 900,
      modes: ['car', 'walk'],
      positionMethod: 'bounding-box-center',
    },
  ],
  issues: [],
};

/** 各模态的节点表:停车点的节点 1 同时在 car 与 walk 图上;公交站节点 5 只在 walk 图上。 */
const NETWORKS = {
  car: new Map<number, readonly [number, number]>([
    [1, PARKING],
    [2, [30.5, 114.31]],
  ]),
  walk: new Map<number, readonly [number, number]>([
    [1, PARKING],
    [5, BUS_STOP_NODE],
    [6, [30.5, 114.32]],
  ]),
  bus: new Map<number, readonly [number, number]>([
    [7, BUS_NODE],
    [8, [30.5, 114.32]],
  ]),
  bike: new Map<number, readonly [number, number]>(),
};

/* ---------- 用例 ---------- */

describe('buildTransferLinks', () => {
  it('同一节点在两个模态上时建立双向连接,接驳距离为 0', () => {
    const links = buildTransferLinks(DATA, { car: NETWORKS.car, walk: NETWORKS.walk });
    const parking = links.filter((link) => link.transferPointId === 100);
    expect(parking).toHaveLength(2);
    for (const link of parking) {
      expect(link.fromNodeId).toBe(1);
      expect(link.toNodeId).toBe(1);
      expect(link.accessMeters).toBe(0);
      expect(link.evidence).toBe('shared-osm-node');
      expect(link.kind).toBe('parking');
    }
    expect(parking.map((link) => `${link.fromMode}->${link.toMode}`).sort()).toEqual([
      'car->walk',
      'walk->car',
    ]);
  });

  it('换乘罚时 = 接驳步行时间 + 等待时间(停车占位 5 分钟)', () => {
    const links = buildTransferLinks(DATA, { car: NETWORKS.car, walk: NETWORKS.walk });
    const link = links.find((item) => item.transferPointId === 100 && item.toMode === 'walk');
    expect(link).toBeDefined();
    // 接驳距离 0 → 只有等待时间:地铁 5 分 / 公交 3 分 / 停车 5 分
    expect(link!.penaltySeconds).toBe(300);
  });

  it('设施节点不在某模态图上时取半径内近邻,并标记为近邻近似', () => {
    const links = buildTransferLinks(DATA, { bus: NETWORKS.bus, walk: NETWORKS.walk });
    const link = links.find((item) => item.transferPointId === 200 && item.fromMode === 'bus');
    expect(link).toBeDefined();
    expect(link!.evidence).toBe('nearby-candidate');
    expect(link!.fromNodeId).toBe(7);
    expect(link!.toNodeId).toBe(5);
    const access = haversineMeters(BUS_NODE, BUS_STOP_NODE);
    expect(link!.accessMeters).toBeCloseTo(access, 6);
    // 罚时 = 接驳步行(access / 1.3 m/s) + 公交等待 180 s
    expect(link!.penaltySeconds).toBeCloseTo(access / 1.3 + 180, 6);
  });

  it('way 型设施缺出入口证据,不建立任何连接', () => {
    const links = buildTransferLinks(DATA, { car: NETWORKS.car, walk: NETWORKS.walk });
    expect(links.filter((link) => link.transferPointId === 300)).toHaveLength(0);
  });

  it('未提供该模态的节点表时不建立连接', () => {
    const links = buildTransferLinks(DATA, { bike: NETWORKS.bike });
    expect(links).toHaveLength(0);
  });

  it('没有可用模态时返回空表', () => {
    expect(buildTransferLinks(DATA, {})).toHaveLength(0);
  });
});

describe('summarizeTransferLinks', () => {
  it('按证据类型与模态对统计,并给出最大接驳距离', () => {
    const links = buildTransferLinks(DATA, {
      car: NETWORKS.car,
      walk: NETWORKS.walk,
      bus: NETWORKS.bus,
    });
    const summary = summarizeTransferLinks(links);
    expect(summary.linkCount).toBe(links.length);
    expect(summary.byEvidence['shared-osm-node']).toBe(2);
    expect(summary.byEvidence['nearby-candidate']).toBe(2);
    expect(summary.byModePair['car->walk']).toBe(1);
    expect(summary.byModePair['bus->walk']).toBe(1);
    expect(summary.maxAccessMeters).toBeGreaterThan(0);
  });
});

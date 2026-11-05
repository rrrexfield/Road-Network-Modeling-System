import { describe, expect, it } from 'vitest';
import { extractTransferPoints } from '../io/index.js';
import {
  buildTransferAttachments,
  computeTransferPenalty,
  type TransferAttachmentReview,
  type TopologyResult,
} from './index.js';

const limits = { car: 100, walk: 200, bike: 100, bus: 200 };
const data = extractTransferPoints({
  nodes: [{ id: 1, lat: 30, lon: 114, tags: [{ k: 'amenity', v: 'parking' }] }],
  ways: [],
});
const car: Pick<TopologyResult, 'nodes' | 'edges'> = {
  nodes: new Map([
    [1, [30, 114]],
    [2, [30.001, 114]],
  ]),
  edges: [{ id: 7, wayId: 9, from: 2, to: 1 }],
};
const review: TransferAttachmentReview = {
  pointId: 2,
  mode: 'car',
  nodeId: 1,
  accessPath: [[114, 30]],
  reference: 'test-only: manually reviewed synthetic fixture',
};
describe('给B消费的逐模式接驳表', () => {
  it('绕行接驳按整条核验路径计长，不以端点直线距离绕过阈值', () => {
    const result = buildTransferAttachments(data, { car }, limits, [
      {
        ...review,
        accessPath: [
          [114, 30],
          [114, 30.001],
          [114, 30],
        ],
      },
    ]);
    expect(result.get(2)!.car).toMatchObject({
      reason: 'access-path-exceeds-threshold',
      distanceM: expect.any(Number),
    });
    expect(() => buildTransferAttachments({ ...data, sources: [] }, { car }, limits)).toThrow(
      '缺少来源',
    );
  });
  it('共享源节点也必须核验，未装载的模式明确不可用', () => {
    const row = buildTransferAttachments(data, { car }, limits).get(2)!;
    expect(row.car).toEqual({
      status: 'unavailable',
      reason: 'review-required',
      candidateNodeId: 1,
      distanceM: 0,
    });
    expect(row.walk).toEqual({ status: 'unavailable', reason: 'mode-not-loaded' });
  });
  it('保留入出方向，数据副本不能改变图或核验输入', () => {
    const row = buildTransferAttachments(data, { car }, limits, [review]).get(2)!.car!;
    expect(row).toMatchObject({
      status: 'available',
      nodeId: 1,
      distanceM: 0,
      incomingEdgeIds: [7],
      outgoingEdgeIds: [],
    });
    if (row.status === 'available') row.accessPath[0]![0] = 0;
    expect(review.accessPath[0]).toEqual([114, 30]);
    expect(car.nodes.get(1)).toEqual([30, 114]);
  });
  it('同一设施不同模式可以接不同节点，阈值按模式单独处理', () => {
    const walk = {
      nodes: new Map<number, [number, number]>([
        [3, [30.001, 114]],
        [4, [30.002, 114]],
      ]),
      edges: [{ id: 7, wayId: 10, from: 3, to: 4 }],
    };
    const row = buildTransferAttachments(data, { car, walk }, limits, [
      review,
      {
        ...review,
        mode: 'walk',
        nodeId: 3,
        accessPath: [
          [114, 30],
          [114, 30.001],
        ],
      },
    ]).get(2)!;
    expect(row.car).toMatchObject({ status: 'available', nodeId: 1 });
    expect(row.walk).toMatchObject({ status: 'available', nodeId: 3, outgoingEdgeIds: [7] });
    const strict = buildTransferAttachments(data, { walk }, { ...limits, walk: 50 }, [
      {
        ...review,
        mode: 'walk',
        nodeId: 3,
        accessPath: [
          [114, 30],
          [114, 30.001],
        ],
      },
    ]);
    expect(strict.get(2)!.walk).toMatchObject({
      status: 'unavailable',
      reason: 'access-path-exceeds-threshold',
    });
  });
  it('路径端点改变与空核验记录均拒绝', () => {
    expect(
      buildTransferAttachments(data, { car }, limits, [{ ...review, accessPath: [[114, 31]] }]).get(
        2,
      )!.car,
    ).toMatchObject({ reason: 'source-geometry-changed' });
    expect(
      buildTransferAttachments(data, { car }, limits, [{ ...review, reference: ' ' }]).get(2)!.car,
    ).toMatchObject({ reason: 'invalid-review' });
  });
  it('区域中心不算入口，显式核验也必须引用入口证据', () => {
    const area = {
      ...data,
      sources: [
        {
          ...data.sources[0]!,
          sourceType: 'way' as const,
          positionMethod: 'bounding-box-center' as const,
        },
      ],
    };
    expect(buildTransferAttachments(area, { car }, limits, [review]).get(2)!.car).toMatchObject({
      reason: 'entrance-evidence-missing',
    });
    const entrances = {
      issues: [],
      entrances: [
        {
          pointId: 2,
          sourceWayId: 1,
          nodeId: 1,
          position: [114, 30] as [number, number],
          modes: ['car' as const],
          evidence: 'tagged-entrance' as const,
          requiresReview: true as const,
        },
      ],
    };
    expect(
      buildTransferAttachments(area, { car }, limits, [review], entrances).get(2)!.car,
    ).toMatchObject({ status: 'available' });
  });
  it('近邻候选超距与同ID坐标变化均不能自动连边', () => {
    const moved = { ...car, nodes: new Map<number, [number, number]>([[3, [31, 114]]]) };
    expect(buildTransferAttachments(data, { walk: moved }, limits).get(2)!.walk).toMatchObject({
      reason: 'no-node-within-radius',
    });
    expect(() => buildTransferAttachments(data, { car }, limits, [review, review])).toThrow(
      '多个核验',
    );
    expect(() => buildTransferAttachments(data, { car }, { ...limits, walk: Infinity })).toThrow(
      '阈值',
    );
  });
  it('孤立节点不可作为可达连接，其他模式的边不参与方向判断', () => {
    expect(
      buildTransferAttachments(data, { car: { ...car, edges: [] } }, limits, [review]).get(2)!.car,
    ).toMatchObject({ reason: 'node-without-directed-edges' });
  });
});
describe('换乘罚时显式输入', () => {
  it('实际步行米数除速度再加等待秒数，不改变距离', () => {
    expect(
      computeTransferPenalty({ walkingDistanceM: 120, walkingSpeedMps: 1.5, waitingSeconds: 30 }),
    ).toBe(110);
    expect(
      computeTransferPenalty({ walkingDistanceM: 0, walkingSpeedMps: 1, waitingSeconds: 0 }),
    ).toBe(0);
  });
  it('拒绝非法速度、负等待和非有限输入', () => {
    for (const bad of [
      { walkingDistanceM: -1, walkingSpeedMps: 1, waitingSeconds: 0 },
      { walkingDistanceM: 1, walkingSpeedMps: 0, waitingSeconds: 0 },
      { walkingDistanceM: 1, walkingSpeedMps: 1, waitingSeconds: Infinity },
    ])
      expect(() => computeTransferPenalty(bad)).toThrow();
  });
});

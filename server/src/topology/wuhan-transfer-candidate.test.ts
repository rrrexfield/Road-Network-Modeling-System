import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Graph, dijkstra } from '../graph/index.js';
import { extractTransferPoints } from '../io/index.js';
import {
  buildModalTopology,
  buildTransferAttachments,
  inspectTransferEntrances,
  type TopologyWay,
} from './index.js';

type Input = Parameters<typeof extractTransferPoints>[0];
const raw = JSON.parse(
  readFileSync(new URL('./fixtures/wuhan-transfer-candidate.json', import.meta.url), 'utf8'),
) as Input & {
  provenance: { requiresReview: boolean; sha256: string };
  scenario: {
    entranceNodeId: number;
    originId: number;
    subwayEntranceId: number;
    parkingWayId: number;
    drivingDistanceM: number;
    walkingDistanceM: number;
  };
};

function build(mode: 'car' | 'walk') {
  const nodes = new Map<number, [number, number]>(raw.nodes.map((n) => [n.id, [n.lat, n.lon]]));
  const ways: TopologyWay[] = raw.ways.flatMap((w) => {
    const tags = Object.fromEntries(w.tags.map((t) => [t.k, t.v]));
    return tags.highway ? [{ id: w.id, nds: w.nds, tags, highway: tags.highway }] : [];
  });
  return buildModalTopology(nodes, ways, mode).topology;
}

describe('武汉停车区域至地铁出入口的路网候选（不是换乘验收）', () => {
  it('武汉区域候选在未核验前不会被B当作可搜索连接', () => {
    const car = build('car');
    const walk = build('walk');
    const data = extractTransferPoints(raw);
    const entrances = inspectTransferEntrances(data, raw, { car: car.nodes, walk: walk.nodes });
    const index = buildTransferAttachments(
      data,
      { car, walk },
      { car: 100, bike: 100, walk: 200, bus: 200 },
      [],
      entrances,
    );
    const row = index.get(2 * raw.scenario.parkingWayId + 1)!;
    expect(row.car).toEqual({ status: 'unavailable', reason: 'entrance-review-required' });
    expect(row.walk).toEqual({ status: 'unavailable', reason: 'entrance-review-required' });
  });
  it('原始片段支持分段有向可达性，但共享边界仍要求核验', () => {
    const car = build('car');
    const walk = build('walk');
    const s = raw.scenario;
    const report = inspectTransferEntrances(extractTransferPoints(raw), raw, {
      car: car.nodes,
      walk: walk.nodes,
    });
    expect(report.entrances).toContainEqual({
      pointId: 2 * s.parkingWayId + 1,
      sourceWayId: s.parkingWayId,
      nodeId: s.entranceNodeId,
      position: expect.any(Array),
      evidence: 'shared-boundary-node',
      modes: ['car', 'walk'],
      requiresReview: true,
    });
    const driving = dijkstra(new Graph(car.nodes, car.edges), s.originId, s.entranceNodeId);
    const walking = dijkstra(
      new Graph(walk.nodes, walk.edges),
      s.entranceNodeId,
      s.subwayEntranceId,
    );
    expect(driving.edgeIds.length).toBeGreaterThan(0);
    expect(walking.edgeIds.length).toBeGreaterThan(1);
    expect(driving.distance).toBeCloseTo(s.drivingDistanceM, 3);
    expect(walking.distance).toBeCloseTo(s.walkingDistanceM, 3);
    expect(raw.provenance.requiresReview).toBe(true);
    expect(raw.provenance.sha256).toMatch(/^[a-f0-9]{64}$/);
    // 汽车图不应把仅步行的地铁入口当作驾车终点。
    expect(car.nodes.has(s.subwayEntranceId)).toBe(false);
  });

  it('切断停车区域到入口的步行路段后不可达，不能以直线近邻补边', () => {
    const walk = build('walk');
    const target = raw.scenario.subwayEntranceId;
    const graph = new Graph(
      walk.nodes,
      walk.edges.filter((e) => e.from !== target && e.to !== target),
    );
    const result = dijkstra(graph, raw.scenario.entranceNodeId, target);
    expect(result.distance).toBe(Infinity);
    expect(result.edgeIds).toEqual([]);
  });
});

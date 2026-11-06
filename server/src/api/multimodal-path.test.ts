import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { PathResponse } from '@gisalgo/shared';
import { Graph } from '../graph/index.js';
import type { LoadedNetwork } from '../io/loader.js';
import type { TransferPointData } from '../io/index.js';
import { buildTopology } from '../topology/index.js';
import { registerRoutes } from './routes.js';
import { createModalRuntimeRegistry, type ModalRuntimeRegistry } from './modal-runtime.js';
import { parseModeSequence } from './multimodal-path.js';

/* ---------- 夹具：丁字路口 + 停车换乘点 ---------- */

/** 节点 id → [lat, lon]。2 号为丁字路口中心,1 号上挂一个停车场(换乘点)。 */
const NODES = new Map<number, [number, number]>([
  [1, [30.5, 114.3]],
  [2, [30.5, 114.31]],
  [3, [30.51, 114.31]],
  [4, [30.49, 114.31]],
  [5, [30.52, 114.31]],
]);

const WAYS = [
  { id: 100, highway: 'primary', tags: { highway: 'primary' }, nds: [1, 2] },
  { id: 200, highway: 'secondary', tags: { highway: 'secondary' }, nds: [2, 3] },
  { id: 300, highway: 'secondary', tags: { highway: 'secondary' }, nds: [2, 4] },
  // 步行专属:car 准入排除,walk 纳入
  { id: 400, highway: 'footway', tags: { highway: 'footway' }, nds: [3, 5] },
];

const TRANSFER_POINTS: TransferPointData = {
  points: [
    { id: 2001, kind: 'parking', position: [114.3, 30.5] },
    { id: 2002, kind: 'bus', position: [114.31, 30.5] },
  ],
  sources: [
    {
      pointId: 2001,
      sourceType: 'node',
      sourceId: 1,
      modes: ['car', 'walk'],
      positionMethod: 'osm-node',
    },
    {
      pointId: 2002,
      sourceType: 'node',
      sourceId: 2,
      modes: ['bus', 'walk'],
      positionMethod: 'osm-node',
    },
  ],
  issues: [],
};

function makeNetwork(): LoadedNetwork {
  const features = WAYS.map((way) => ({
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: way.nds.map((id) => {
        const p = NODES.get(id)!;
        return [p[1], p[0]] as [number, number];
      }),
    },
    properties: { id: way.id, highway: way.highway, tags: way.tags },
  }));
  return {
    meta: {
      source: 'test',
      generatedAt: '2026-11-06T00:00:00.000Z',
      nodeCount: NODES.size,
      wayCount: WAYS.length,
      segmentCount: WAYS.length,
      bbox: [114.3, 30.49, 114.31, 30.52],
    },
    nodes: NODES,
    ways: WAYS,
    geojson: { type: 'FeatureCollection', features },
    nodeTags: new Map(),
    relations: [],
    transferPoints: {
      points: TRANSFER_POINTS.points.map((p) => ({ ...p, position: [...p.position] })),
      sources: TRANSFER_POINTS.sources.map((s) => ({ ...s, modes: [...s.modes] })),
      issues: [],
    },
    dataWarnings: [],
  };
}

const directories: string[] = [];
function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gisalgo-multimodal-test-'));
  directories.push(directory);
  return join(directory, 'turns.sqlite');
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
      throw new Error('测试清理路径越界');
    rmSync(directory, { recursive: true });
  }
});

function makeRegistry(): ModalRuntimeRegistry {
  return createModalRuntimeRegistry(makeNetwork(), {
    databasePath: databasePath(),
    dataset: 'test',
  });
}

async function buildApp(registry?: ModalRuntimeRegistry) {
  const network = makeNetwork();
  const topology = buildTopology(network.nodes, network.ways);
  const graph = new Graph(topology.nodes, topology.edges);
  const wayHighway = new Map([...topology.ways].map(([id, way]) => [id, way.highway]));
  const app = Fastify();
  await registerRoutes(
    app,
    network,
    { nodeCount: NODES.size, edgeCount: topology.edges.length, wayCount: WAYS.length },
    { graph, wayHighway },
    registry,
  );
  return app;
}

/* ---------- 用例 ---------- */

describe('parseModeSequence', () => {
  it('按给定顺序解析并去重', () => {
    expect(parseModeSequence('car,walk')).toEqual(['car', 'walk']);
    expect(parseModeSequence(' walk , bus ')).toEqual(['walk', 'bus']);
    expect(parseModeSequence('car,car,walk')).toEqual(['car', 'walk']);
  });

  it('非法输入返回 null', () => {
    expect(parseModeSequence('car,plane')).toBeNull();
    expect(parseModeSequence('')).toBeNull();
    expect(parseModeSequence(undefined)).toBeNull();
    expect(parseModeSequence(42)).toBeNull();
  });
});

describe('GET /api/path?modes=', () => {
  it('跨模态路径按转换点换乘,分段给出模态与换乘点', async () => {
    const app = await buildApp(makeRegistry());
    // 节点 4 → 停车场(节点 1)驾车 → 换乘 → 步行到节点 5(需走 footway)
    const res = await app.inject({
      method: 'GET',
      url: '/api/path?from=114.310,30.490&to=114.310,30.520&metric=distance&modes=car,walk',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PathResponse;
    expect(body.segments).toBeDefined();
    const segments = body.segments!;
    expect(segments).toHaveLength(2);
    expect(segments[0]!.mode).toBe('car');
    expect(segments[0]!.nodeIds).toEqual([4, 2, 1]);
    expect(segments[0]!.toTransferPoint).toBe(2001);
    expect(segments[0]!.fromTransferPoint).toBeUndefined();
    expect(segments[1]!.mode).toBe('walk');
    expect(segments[1]!.nodeIds).toEqual([1, 2, 3, 5]);
    expect(segments[1]!.fromTransferPoint).toBe(2001);
    expect(segments[1]!.toTransferPoint).toBeUndefined();

    // 跨模态时顶层不给出跨模态的边序列(边 id 只在所属模态内有效)
    expect(body.edgeIds).toEqual([]);
    expect(body.nodeIds).toEqual([4, 2, 1, 1, 2, 3, 5]);
    // distance 口径:换乘罚时不计入
    expect(body.transferPenaltySeconds).toBe(300);
    const segmentSum = segments.reduce((total, segment) => total + segment.distance, 0);
    expect(body.distance).toBeCloseTo(segmentSum, 6);

    await app.close();
  });

  it('time 口径下换乘罚时单独下发,不混入 distance', async () => {
    const app = await buildApp(makeRegistry());
    const res = await app.inject({
      method: 'GET',
      url: '/api/path?from=114.310,30.490&to=114.310,30.520&metric=time&modes=car,walk',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PathResponse;
    const segments = body.segments!;
    const segmentSum = segments.reduce((total, segment) => total + segment.distance, 0);
    // distance 只表达各段代价之和,换乘罚时按契约单独下发
    expect(body.distance).toBeCloseTo(segmentSum, 6);
    // 停车场换乘的等待罚时为占位值 5 分钟
    expect(body.transferPenaltySeconds).toBe(300);
    // 步行段按步行速度(4.5 km/h)折算,3 km 步行约 40 分钟,明显大于 5 分钟的换乘罚时
    expect(segmentSum).toBeGreaterThan(body.transferPenaltySeconds!);

    await app.close();
  });

  it('没有可用换乘连接的模态组合返回 404', async () => {
    const app = await buildApp(makeRegistry());
    // car → bike 之间没有换乘连接(夹具里只有 car↔walk 与 bus↔walk)
    const res = await app.inject({
      method: 'GET',
      url: '/api/path?from=114.310,30.490&to=114.310,30.520&modes=car,bike',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('modes 非法或与 mode 混用返回 400', async () => {
    const app = await buildApp(makeRegistry());
    const base = 'from=114.310,30.490&to=114.310,30.520';

    expect((await app.inject({ method: 'GET', url: `/api/path?${base}&modes=car` })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: `/api/path?${base}&modes=car,plane` })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: `/api/path?${base}&mode=car&modes=car,walk` }))
        .statusCode,
    ).toBe(400);

    await app.close();
  });

  it('单模态请求不带 segments,行为与作业一一致', async () => {
    const app = await buildApp(makeRegistry());
    const res = await app.inject({
      method: 'GET',
      url: '/api/path?from=114.300,30.500&to=114.310,30.500',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PathResponse;
    expect(body.segments).toBeUndefined();
    expect(body.transferPenaltySeconds).toBeUndefined();
    expect(body.nodeIds).toEqual([1, 2]);
    await app.close();
  });
});

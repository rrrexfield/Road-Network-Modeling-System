import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { PathResponse, TrafficEvent } from '@gisalgo/shared';
import { Graph } from '../graph/index.js';
import type { LoadedNetwork } from '../io/loader.js';
import { buildTopology } from '../topology/index.js';
import { registerRoutes } from './routes.js';
import { createModalRuntimeRegistry, type ModalRuntimeRegistry } from './modal-runtime.js';

/*
 * 作业三 A 侧接线测试：
 * - 压缩图与原图路径在保留端点上一致（节点/边序列 + 代价）；
 * - 端点落在被压缩节点时回退原图；
 * - 禁转保存后 turnVersion +1、压缩图重建、路径绕行；
 * - 交通参数（hour / congestion=off / 预置事件）在两种口径下一致；
 * - /api/compression 统计与 400/501/503 错误码。
 *
 * 夹具：1—6—7—2 为可压缩直行链，1 与 3 另有 1—8—9—3 的绕行链，
 * 2—3 / 2—4 为支路，1—10 / 3—11 为叶节点（保证 1/3 是路口而非度-2 节点）。
 */

const NODES = new Map<number, [number, number]>([
  [1, [30.5, 114.3]],
  [6, [30.5, 114.31]],
  [7, [30.5, 114.32]],
  [2, [30.5, 114.33]],
  [3, [30.51, 114.34]],
  [4, [30.49, 114.33]],
  [8, [30.52, 114.3]],
  [9, [30.52, 114.34]],
  [10, [30.5, 114.29]],
  [11, [30.51, 114.35]],
]);

interface WayFixture {
  id: number;
  highway: string;
  tags: Record<string, string>;
  nds: number[];
}

const WAYS: WayFixture[] = [
  { id: 100, highway: 'primary', tags: {}, nds: [1, 6, 7, 2] },
  { id: 200, highway: 'secondary', tags: {}, nds: [2, 3] },
  { id: 300, highway: 'secondary', tags: { oneway: 'yes' }, nds: [2, 4] },
  { id: 500, highway: 'tertiary', tags: {}, nds: [1, 8, 9, 3] },
  { id: 600, highway: 'residential', tags: {}, nds: [1, 10] },
  { id: 700, highway: 'residential', tags: {}, nds: [3, 11] },
];

const EMPTY_TRANSFERS = { points: [], sources: [], issues: [] };

const TRANSFER_AT_6 = {
  points: [{ id: 5001, kind: 'parking' as const, position: [114.31, 30.5] as [number, number] }],
  sources: [
    {
      pointId: 5001,
      sourceType: 'node' as const,
      sourceId: 6,
      modes: ['car', 'walk'] as const,
      positionMethod: 'osm-node' as const,
    },
  ],
  issues: [],
};

interface NetworkOptions {
  transferAt6?: boolean;
  dataWarnings?: string[];
}

function makeNetwork(options: NetworkOptions = {}): LoadedNetwork {
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
  const transfers = options.transferAt6 === true ? TRANSFER_AT_6 : EMPTY_TRANSFERS;
  return {
    meta: {
      source: 'test',
      generatedAt: '2026-11-26T00:00:00.000Z',
      nodeCount: NODES.size,
      wayCount: WAYS.length,
      segmentCount: WAYS.reduce((sum, way) => sum + way.nds.length - 1, 0),
      bbox: [114.29, 30.49, 114.35, 30.52],
    },
    nodes: NODES,
    ways: WAYS,
    geojson: { type: 'FeatureCollection', features },
    nodeTags: new Map(),
    relations: [],
    transferPoints: {
      points: transfers.points.map((point) => ({
        ...point,
        position: [...point.position] as [number, number],
      })),
      sources: transfers.sources.map((source) => ({ ...source, modes: [...source.modes] })),
      issues: [],
    },
    dataWarnings: options.dataWarnings ?? [],
  };
}

const directories: string[] = [];
function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gisalgo-compression-test-'));
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

function makeRegistry(network: LoadedNetwork): ModalRuntimeRegistry {
  return createModalRuntimeRegistry(network, {
    databasePath: databasePath(),
    dataset: 'test',
  });
}

async function buildApp(
  network: LoadedNetwork,
  registry?: ModalRuntimeRegistry,
  trafficEvents?: readonly TrafficEvent[],
) {
  const topology = buildTopology(network.nodes, network.ways);
  const graph = new Graph(topology.nodes, topology.edges);
  const wayHighway = new Map([...topology.ways].map(([id, way]) => [id, way.highway]));
  const app = Fastify();
  await registerRoutes(
    app,
    network,
    {
      nodeCount: NODES.size,
      edgeCount: topology.edges.length,
      wayCount: WAYS.length,
    },
    { graph, wayHighway, ...(trafficEvents === undefined ? {} : { trafficEvents }) },
    registry,
  );
  return app;
}

/** 起点 = 节点 1，终点 = 节点 3 的坐标；压缩/原图都会精确吸附到这两个保留节点。 */
const FROM = '114.3,30.5';
const TO = '114.34,30.51';
/** 节点 6 是链中间点，压缩后会被合并。 */
const FROM_CONTRACTED = '114.31,30.5';

function pathUrl(options: {
  compressed?: boolean;
  metric?: 'time';
  extra?: string;
  from?: string;
  to?: string;
}): string {
  const params = [
    `from=${options.from ?? FROM}`,
    `to=${options.to ?? TO}`,
    'mode=car',
    ...(options.metric === 'time' ? ['metric=time'] : []),
    ...(options.compressed === true ? ['compressed=1'] : []),
    ...(options.extra === undefined ? [] : [options.extra]),
  ];
  return `/api/path?${params.join('&')}`;
}

describe('压缩图接线', () => {
  it('保留端点上压缩/原图路径的节点、边与代价一致', async () => {
    const network = makeNetwork();
    const app = await buildApp(network, makeRegistry(network));

    const original = await app.inject({ method: 'GET', url: pathUrl({}) });
    const compressed = await app.inject({ method: 'GET', url: pathUrl({ compressed: true }) });
    expect(original.statusCode).toBe(200);
    expect(compressed.statusCode).toBe(200);

    const base = original.json<PathResponse>();
    const fast = compressed.json<PathResponse>();
    expect(fast.compression).toEqual({ applied: true, turnVersion: 0 });
    expect(fast.nodeIds).toEqual(base.nodeIds);
    expect(fast.edgeIds).toEqual(base.edgeIds);
    expect(fast.coordinates).toEqual(base.coordinates);
    expect(fast.distance).toBeCloseTo(base.distance, 6);
  });

  it('端点落在被压缩节点时回退原图并标记 applied=false', async () => {
    const network = makeNetwork();
    const app = await buildApp(network, makeRegistry(network));

    const original = await app.inject({
      method: 'GET',
      url: pathUrl({ from: FROM_CONTRACTED }),
    });
    const fallback = await app.inject({
      method: 'GET',
      url: pathUrl({ from: FROM_CONTRACTED, compressed: true }),
    });
    expect(fallback.statusCode).toBe(200);

    const base = original.json<PathResponse>();
    const body = fallback.json<PathResponse>();
    expect(body.compression?.applied).toBe(false);
    expect(body.nodeIds).toEqual(base.nodeIds);
    expect(body.edgeIds).toEqual(base.edgeIds);
    expect(body.distance).toBeCloseTo(base.distance, 6);
  });

  it('禁转保存后 turnVersion 递增、压缩图重建并绕行；清空后恢复', async () => {
    const network = makeNetwork();
    const registry = makeRegistry(network);
    const app = await buildApp(network, registry);

    const stats0 = await app.inject({ method: 'GET', url: '/api/compression?mode=car' });
    expect(stats0.statusCode).toBe(200);

    const turns = await app.inject({
      method: 'GET',
      url: '/api/intersections/2/turns?mode=car',
    });
    expect(turns.statusCode).toBe(200);
    const direct = turns
      .json<{ turns: { fromEdge: number; toEdge: number; fromWayId: number; toWayId: number }[] }>()
      .turns.find((turn) => turn.fromWayId === 100 && turn.toWayId === 200);
    expect(direct).toBeDefined();

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/intersections/2/turns?mode=car',
      payload: { forbidden: [{ fromEdge: direct!.fromEdge, toEdge: direct!.toEdge }] },
    });
    expect(saved.statusCode).toBe(200);

    const stats1 = await app.inject({ method: 'GET', url: '/api/compression?mode=car' });
    expect(stats1.json<{ turnVersion: number }>().turnVersion).toBe(1);

    const original = await app.inject({ method: 'GET', url: pathUrl({}) });
    const compressed = await app.inject({ method: 'GET', url: pathUrl({ compressed: true }) });
    expect(original.statusCode).toBe(200);
    expect(compressed.statusCode).toBe(200);
    const base = original.json<PathResponse>();
    const fast = compressed.json<PathResponse>();
    // 直行被禁后必须走 1—8—9—3 绕行链；压缩路径展开后与原图逐位一致。
    expect(base.nodeIds).toContain(8);
    expect(base.nodeIds).toContain(9);
    expect(fast.nodeIds).toEqual(base.nodeIds);
    expect(fast.edgeIds).toEqual(base.edgeIds);
    expect(fast.compression).toEqual({ applied: true, turnVersion: 1 });
    expect(fast.distance).toBeCloseTo(base.distance, 6);

    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/intersections/2/turns?mode=car',
      payload: { forbidden: [] },
    });
    expect(cleared.statusCode).toBe(200);
    const restored = await app.inject({ method: 'GET', url: pathUrl({ compressed: true }) });
    expect(restored.json<PathResponse>().nodeIds).not.toContain(8);
  });

  it('换乘端点进入压缩保留集', async () => {
    const network = makeNetwork({ transferAt6: true });
    const app = await buildApp(network, makeRegistry(network));

    const response = await app.inject({ method: 'GET', url: '/api/compression?mode=car' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      protectedNodeCount: number;
      stats: { originalNodeCount: number; compressedNodeCount: number };
    }>();
    expect(body.stats.originalNodeCount).toBe(10);
    // 节点 6 被换乘端点保留，节点 7/8/9 仍可压缩 → 10 - 3 = 7。
    expect(body.stats.compressedNodeCount).toBe(7);
    expect(body.protectedNodeCount).toBeGreaterThanOrEqual(1);
  });
});

describe('交通参数接线', () => {
  it('hour 只改变时间口径，不改变路径；congestion=off 回到无交通基线', async () => {
    const network = makeNetwork();
    const app = await buildApp(network, makeRegistry(network));

    const noHour = (
      await app.inject({ method: 'GET', url: pathUrl({ metric: 'time' }) })
    ).json<PathResponse>();
    const night = (
      await app.inject({ method: 'GET', url: pathUrl({ metric: 'time', extra: 'hour=0' }) })
    ).json<PathResponse>();
    const peak = (
      await app.inject({ method: 'GET', url: pathUrl({ metric: 'time', extra: 'hour=8.5' }) })
    ).json<PathResponse>();
    const off = (
      await app.inject({
        method: 'GET',
        url: pathUrl({ metric: 'time', extra: 'hour=8.5&congestion=off' }),
      })
    ).json<PathResponse>();

    // hour=0 带夜间系数（默认曲线 0.85），不是"无交通"；congestion=off 才是 Sprint 2 基线。
    expect(night.distance).toBeLessThan(noHour.distance);
    expect(peak.distance).toBeGreaterThan(noHour.distance);
    expect(off.distance).toBeCloseTo(noHour.distance, 9);
    for (const body of [night, peak, off]) expect(body.nodeIds).toEqual(noHour.nodeIds);
  });

  it('压缩口径与时间槽口径一致', async () => {
    const network = makeNetwork();
    const app = await buildApp(network, makeRegistry(network));

    const original = (
      await app.inject({ method: 'GET', url: pathUrl({ metric: 'time', extra: 'hour=8.5' }) })
    ).json<PathResponse>();
    const compressed = (
      await app.inject({
        method: 'GET',
        url: pathUrl({ metric: 'time', compressed: true, extra: 'hour=8.5' }),
      })
    ).json<PathResponse>();

    expect(compressed.nodeIds).toEqual(original.nodeIds);
    expect(compressed.edgeIds).toEqual(original.edgeIds);
    expect(compressed.distance).toBeCloseTo(original.distance, 6);
  });

  it('预置封闭事件在压缩/原图两种口径下都迫使绕行', async () => {
    const network = makeNetwork();
    const events: TrafficEvent[] = [{ wayIds: [100], kind: 'closure' }];
    const app = await buildApp(network, makeRegistry(network), events);

    const original = await app.inject({
      method: 'GET',
      url: pathUrl({ metric: 'time', extra: 'hour=9' }),
    });
    const compressed = await app.inject({
      method: 'GET',
      url: pathUrl({ metric: 'time', compressed: true, extra: 'hour=9' }),
    });
    expect(original.statusCode).toBe(200);
    expect(compressed.statusCode).toBe(200);
    const base = original.json<PathResponse>();
    const fast = compressed.json<PathResponse>();
    expect(base.nodeIds).toContain(8);
    expect(base.nodeIds).toContain(9);
    expect(fast.nodeIds).toEqual(base.nodeIds);
    expect(fast.compression?.applied).toBe(true);

    const bypass = await app.inject({
      method: 'GET',
      url: pathUrl({ metric: 'time', extra: 'hour=9&events=off' }),
    });
    expect(bypass.json<PathResponse>().nodeIds).not.toContain(8);
  });
});

describe('压缩与参数错误码', () => {
  it('compressed 非法值或与 modes/缺 mode 组合时返回 400', async () => {
    const network = makeNetwork();
    const app = await buildApp(network, makeRegistry(network));

    const badFlag = await app.inject({
      method: 'GET',
      url: `/api/path?from=${FROM}&to=${TO}&mode=car&compressed=yes`,
    });
    expect(badFlag.statusCode).toBe(400);

    const noMode = await app.inject({
      method: 'GET',
      url: `/api/path?from=${FROM}&to=${TO}&compressed=1`,
    });
    expect(noMode.statusCode).toBe(400);

    const withModes = await app.inject({
      method: 'GET',
      url: `/api/path?from=${FROM}&to=${TO}&compressed=1&modes=car,walk`,
    });
    expect(withModes.statusCode).toBe(400);
  });

  it('/api/compression 返回统计；非法 mode 400、无运行时 501、数据不可用 503', async () => {
    const network = makeNetwork();
    const registry = makeRegistry(network);
    const app = await buildApp(network, registry);

    const ok = await app.inject({ method: 'GET', url: '/api/compression?mode=car' });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<{
      mode: string;
      turnVersion: number;
      cached: boolean;
      stats: {
        originalNodeCount: number;
        originalEdgeCount: number;
        compressedNodeCount: number;
        compressedEdgeCount: number;
        nodeReduction: number;
        edgeReduction: number;
      };
    }>();
    expect(body.mode).toBe('car');
    expect(body.turnVersion).toBe(0);
    expect(body.stats.originalNodeCount).toBe(10);
    expect(body.stats.compressedNodeCount).toBe(6);
    expect(body.stats.originalEdgeCount).toBe(19);
    expect(body.stats.compressedEdgeCount).toBe(11);
    expect(body.stats.nodeReduction).toBeCloseTo(0.4, 9);
    expect(body.stats.edgeReduction).toBeCloseTo(1 - 11 / 19, 9);

    const cached = await app.inject({ method: 'GET', url: '/api/compression?mode=car' });
    expect(cached.json<{ cached: boolean }>().cached).toBe(true);

    const badMode = await app.inject({ method: 'GET', url: '/api/compression?mode=plane' });
    expect(badMode.statusCode).toBe(400);

    const noRegistry = await buildApp(network, undefined);
    const disabled = await noRegistry.inject({ method: 'GET', url: '/api/compression' });
    expect(disabled.statusCode).toBe(501);

    const brokenNetwork = makeNetwork({ dataWarnings: ['派生数据缺少 Sprint2 字段'] });
    const brokenApp = await buildApp(brokenNetwork, makeRegistry(brokenNetwork));
    const unavailable = await brokenApp.inject({ method: 'GET', url: '/api/compression' });
    expect(unavailable.statusCode).toBe(503);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  IntersectionTurns,
  NearestIntersectionResponse,
  RoadFeatureCollection,
} from '@gisalgo/shared';
import { Graph } from '../graph/index.js';
import type { LoadedNetwork } from '../io/loader.js';
import { buildTopology } from '../topology/index.js';
import { registerRoutes } from './routes.js';
import {
  mapTurnError,
  parseCoordinate,
  parseMaxDistance,
  parseMode,
  parseNodeId,
  parseSetTurnsRequest,
} from './modal-routes.js';
import {
  createModalRuntimeRegistry,
  isTravelMode,
  type ModalRuntimeRegistry,
} from './modal-runtime.js';

/* ---------- 夹具：丁字路口 ---------- */

/** 节点 id → [lat, lon]。2 号为丁字路口的中心。 */
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
  // 步行专属：car 准入排除，walk 纳入
  { id: 400, highway: 'footway', tags: { highway: 'footway' }, nds: [3, 5] },
];

const TRANSFER_POINTS = {
  points: [
    { id: 2001, kind: 'parking' as const, position: [114.3, 30.5] as [number, number] },
    { id: 2002, kind: 'bus' as const, position: [114.31, 30.5] as [number, number] },
    { id: 2003, kind: 'subway' as const, position: [114.32, 30.5] as [number, number] },
  ],
  sources: [
    {
      pointId: 2001,
      sourceType: 'node' as const,
      sourceId: 1,
      modes: ['car', 'walk'] as const,
      positionMethod: 'osm-node' as const,
    },
    {
      pointId: 2002,
      sourceType: 'node' as const,
      sourceId: 2,
      modes: ['bus', 'walk'] as const,
      positionMethod: 'osm-node' as const,
    },
    {
      pointId: 2003,
      sourceType: 'node' as const,
      sourceId: 3,
      modes: ['walk'] as const,
      positionMethod: 'osm-node' as const,
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
      generatedAt: '2026-11-04T00:00:00.000Z',
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
      points: TRANSFER_POINTS.points.map((p) => ({
        ...p,
        position: [...p.position] as [number, number],
      })),
      sources: TRANSFER_POINTS.sources.map((s) => ({ ...s, modes: [...s.modes] })),
      issues: [],
    },
    dataWarnings: [],
  };
}

const directories: string[] = [];
function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gisalgo-modal-test-'));
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

function makeRegistry(capacity?: number): ModalRuntimeRegistry {
  return createModalRuntimeRegistry(makeNetwork(), {
    databasePath: databasePath(),
    dataset: 'test',
    ...(capacity === undefined ? {} : { capacity }),
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

/* ---------- 解析与错误映射 ---------- */

describe('模态与参数解析', () => {
  it('缺省模态为 car,非法模态返回 null', () => {
    expect(parseMode(undefined)).toBe('car');
    expect(parseMode('walk')).toBe('walk');
    expect(parseMode('plane')).toBeNull();
    expect(isTravelMode('bus')).toBe(true);
    expect(isTravelMode('plane')).toBe(false);
  });

  it('节点 ID 必须是安全整数', () => {
    expect(parseNodeId('42')).toBe(42);
    expect(parseNodeId('4.2')).toBeNull();
    expect(parseNodeId('abc')).toBeNull();
  });

  it('请求体必须是冻结契约的形状', () => {
    expect(parseSetTurnsRequest({ forbidden: [{ fromEdge: 1, toEdge: 2 }] })).toEqual({
      forbidden: [{ fromEdge: 1, toEdge: 2 }],
    });
    expect(parseSetTurnsRequest({ forbidden: [{ fromEdge: 1.5, toEdge: 2 }] })).toBeNull();
    expect(parseSetTurnsRequest({ forbidden: 'x' })).toBeNull();
    expect(parseSetTurnsRequest(undefined)).toBeNull();
  });

  it('经纬度必须合法,半径必须在 0 到上限之间', () => {
    expect(parseCoordinate('114.3', 180)).toBe(114.3);
    expect(parseCoordinate('30.5', 90)).toBe(30.5);
    expect(parseCoordinate('181', 180)).toBeNull();
    expect(parseCoordinate('91', 90)).toBeNull();
    expect(parseCoordinate('abc', 180)).toBeNull();
    expect(parseCoordinate(undefined, 180)).toBeNull();

    expect(parseMaxDistance(undefined)).toBe(15);
    expect(parseMaxDistance('30')).toBe(30);
    expect(parseMaxDistance('0')).toBeNull();
    expect(parseMaxDistance('-5')).toBeNull();
    expect(parseMaxDistance('1000')).toBeNull();
  });
});

/* ---------- /api/path 的模态权重(issue #47) ---------- */

describe('GET /api/path 的模态权重', () => {
  it('显式 mode 时按该模态的速度算时间,步行明显慢于汽车', async () => {
    const app = await buildApp(makeRegistry());
    const url = 'from=114.300,30.500&to=114.310,30.500&metric=time';

    const car = await app.inject({ method: 'GET', url: `/api/path?mode=car&${url}` });
    const walk = await app.inject({ method: 'GET', url: `/api/path?mode=walk&${url}` });
    expect(car.statusCode).toBe(200);
    expect(walk.statusCode).toBe(200);

    const carSeconds = (car.json() as { distance: number }).distance;
    const walkSeconds = (walk.json() as { distance: number }).distance;
    // primary:汽车 60 km/h,步行 4 km/h(模态速度表)——时间口径相差约 15 倍
    expect(walkSeconds).toBeGreaterThan(carSeconds * 5);

    await app.close();
  });

  it('distance 口径与模态无关,两模态里程一致', async () => {
    const app = await buildApp(makeRegistry());
    const url = 'from=114.300,30.500&to=114.310,30.500&metric=distance';

    const car = await app.inject({ method: 'GET', url: `/api/path?mode=car&${url}` });
    const walk = await app.inject({ method: 'GET', url: `/api/path?mode=walk&${url}` });
    expect(car.statusCode).toBe(200);
    expect(walk.statusCode).toBe(200);

    const carMeters = (car.json() as { distance: number }).distance;
    const walkMeters = (walk.json() as { distance: number }).distance;
    expect(walkMeters).toBeCloseTo(carMeters, 3);

    await app.close();
  });

  it('缺省 mode 走基础图,时间口径与 car 模态一致', async () => {
    const app = await buildApp(makeRegistry());
    const url = 'from=114.300,30.500&to=114.310,30.500&metric=time';

    const base = await app.inject({ method: 'GET', url: `/api/path?${url}` });
    const car = await app.inject({ method: 'GET', url: `/api/path?mode=car&${url}` });
    expect(base.statusCode).toBe(200);
    expect(car.statusCode).toBe(200);

    const baseSeconds = (base.json() as { distance: number }).distance;
    const carSeconds = (car.json() as { distance: number }).distance;
    expect(baseSeconds).toBeCloseTo(carSeconds, 6);

    await app.close();
  });
});

/* ---------- /api/intersections/nearest ---------- */

describe('GET /api/intersections/nearest', () => {
  it('命中丁字路口中心节点', async () => {
    const app = await buildApp(makeRegistry());
    const res = await app.inject({
      method: 'GET',
      url: '/api/intersections/nearest?lon=114.31&lat=30.5&mode=car',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as NearestIntersectionResponse;
    expect(body.nodeId).toBe(2);
    expect(body.degree).toBe(3);
    expect(body.distanceMeters).toBeCloseTo(0, 3);
    expect(body.connectedWayIds).toEqual([100, 200, 300]);
    await app.close();
  });

  it('阈值外不命中,返回 404', async () => {
    const app = await buildApp(makeRegistry());
    // 距路口约 1.1 km，超过默认 15 米
    const res = await app.inject({
      method: 'GET',
      url: '/api/intersections/nearest?lon=114.3&lat=30.5&mode=car',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('非法参数返回 400', async () => {
    const app = await buildApp(makeRegistry());

    const badMode = await app.inject({
      method: 'GET',
      url: '/api/intersections/nearest?lon=114.31&lat=30.5&mode=plane',
    });
    expect(badMode.statusCode).toBe(400);

    const badLon = await app.inject({
      method: 'GET',
      url: '/api/intersections/nearest?lon=999&lat=30.5&mode=car',
    });
    expect(badLon.statusCode).toBe(400);

    const badDistance = await app.inject({
      method: 'GET',
      url: '/api/intersections/nearest?lon=114.31&lat=30.5&mode=car&maxDistanceM=9999',
    });
    expect(badDistance.statusCode).toBe(400);

    await app.close();
  });

  it('路口判定按模态进行,相连 Way 随模态变化', async () => {
    const app = await buildApp(makeRegistry());

    // car 模态：节点 2 的相邻道路只有 way 100/200/300
    const car = await app.inject({
      method: 'GET',
      url: '/api/intersections/nearest?lon=114.31&lat=30.5&mode=car',
    });
    expect(car.statusCode).toBe(200);
    expect((car.json() as NearestIntersectionResponse).connectedWayIds).toEqual([100, 200, 300]);

    // walk 模态：way 400 为步行专属，节点 2 的相邻道路集合不变，
    // 但节点 3 的邻接节点数由 1 升为 2 —— 仍不是路口，不应被误判。
    const walk = await app.inject({
      method: 'GET',
      url: '/api/intersections/nearest?lon=114.31&lat=30.51&mode=walk&maxDistanceM=50',
    });
    expect(walk.statusCode).toBe(404);

    await app.close();
  });
});

describe('mapTurnError', () => {
  it('按消息前缀映射为明确状态码', () => {
    expect(mapTurnError(new Error('路口不存在或坐标非法: 9')).status).toBe(404);
    expect(mapTurnError(new Error('转向几何无法判定: 1 → 2 @ 3')).status).toBe(422);
    expect(mapTurnError(new Error('非法转向边对')).status).toBe(400);
    expect(mapTurnError(new Error('非法禁转请求')).status).toBe(400);
    expect(mapTurnError(new Error('恢复存在失配,须先处理诊断,禁止覆盖旧快照')).status).toBe(409);
    expect(mapTurnError(new Error('其他故障')).status).toBe(500);
  });
});

/* ---------- /api/network?mode= ---------- */

describe('GET /api/network', () => {
  it('不带 mode 时行为与原来一致', async () => {
    const app = await buildApp(makeRegistry());
    const res = await app.inject({ method: 'GET', url: '/api/network' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RoadFeatureCollection;
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(WAYS.length);
    await app.close();
  });

  it('按模态过滤道路:car 排除步行专属,walk 纳入', async () => {
    const app = await buildApp(makeRegistry());
    const car = (
      await app.inject({ method: 'GET', url: '/api/network?mode=car' })
    ).json() as RoadFeatureCollection;
    const walk = (
      await app.inject({ method: 'GET', url: '/api/network?mode=walk' })
    ).json() as RoadFeatureCollection;
    expect(car.features.map((f) => f.properties.id)).not.toContain(400);
    expect(walk.features.map((f) => f.properties.id)).toContain(400);
    await app.close();
  });

  it('未知模态返回 400', async () => {
    const app = await buildApp(makeRegistry());
    const res = await app.inject({ method: 'GET', url: '/api/network?mode=plane' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('mode');
    await app.close();
  });
});

/* ---------- /api/transfer-points ---------- */

describe('GET /api/transfer-points', () => {
  it('按模态筛选转换点', async () => {
    const app = await buildApp(makeRegistry());
    const car = await app.inject({ method: 'GET', url: '/api/transfer-points?mode=car' });
    expect(car.statusCode).toBe(200);
    expect((car.json() as { id: number }[]).map((p) => p.id)).toEqual([2001]);

    const bus = await app.inject({ method: 'GET', url: '/api/transfer-points?mode=bus' });
    expect((bus.json() as { id: number }[]).map((p) => p.id)).toEqual([2002]);
    await app.close();
  });

  it('未知模态返回 400', async () => {
    const app = await buildApp(makeRegistry());
    const res = await app.inject({ method: 'GET', url: '/api/transfer-points?mode=plane' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

/* ---------- /api/intersections/:nodeId/turns ---------- */

describe('GET /api/intersections/:nodeId/turns', () => {
  it('返回该路口的全部转向动作', async () => {
    const app = await buildApp(makeRegistry());
    const res = await app.inject({ method: 'GET', url: '/api/intersections/2/turns' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as IntersectionTurns;
    expect(body.nodeId).toBe(2);
    expect(body.position[0]).toBeCloseTo(114.31, 5);
    // 3 条入边 × 3 条出边
    expect(body.turns).toHaveLength(9);
    expect(body.turns.every((t) => t.forbidden === false)).toBe(true);
    await app.close();
  });

  it('不存在的路口返回 404,非法节点 ID 返回 400', async () => {
    const app = await buildApp(makeRegistry());
    const missing = await app.inject({ method: 'GET', url: '/api/intersections/999/turns' });
    expect(missing.statusCode).toBe(404);
    const invalid = await app.inject({ method: 'GET', url: '/api/intersections/abc/turns' });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});

describe('PUT /api/intersections/:nodeId/turns', () => {
  it('整体覆盖该路口禁转集合,写入后 GET 可见', async () => {
    const app = await buildApp(makeRegistry());
    const before = (
      await app.inject({ method: 'GET', url: '/api/intersections/2/turns' })
    ).json() as IntersectionTurns;
    const target = before.turns[0]!;

    const put = await app.inject({
      method: 'PUT',
      url: '/api/intersections/2/turns',
      payload: { forbidden: [{ fromEdge: target.fromEdge, toEdge: target.toEdge }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true, restrictionCount: 1 });

    const after = (
      await app.inject({ method: 'GET', url: '/api/intersections/2/turns' })
    ).json() as IntersectionTurns;
    const changed = after.turns.find(
      (t) => t.fromEdge === target.fromEdge && t.toEdge === target.toEdge,
    )!;
    expect(changed.forbidden).toBe(true);
    expect(changed.fromOsm).toBe(false);
    // 其余转向不受影响
    expect(after.turns.filter((t) => t.forbidden)).toHaveLength(1);
    await app.close();
  });

  it('非法边对返回 400,非法请求体返回 400', async () => {
    const app = await buildApp(makeRegistry());
    const invalidPair = await app.inject({
      method: 'PUT',
      url: '/api/intersections/2/turns',
      payload: { forbidden: [{ fromEdge: 999, toEdge: 1000 }] },
    });
    expect(invalidPair.statusCode).toBe(400);

    const invalidBody = await app.inject({
      method: 'PUT',
      url: '/api/intersections/2/turns',
      payload: { forbidden: [{ fromEdge: 'a', toEdge: 1 }] },
    });
    expect(invalidBody.statusCode).toBe(400);
    await app.close();
  });
});

/* ---------- /api/path?mode= ---------- */

describe('GET /api/path?mode=', () => {
  it('禁转后路径绕行且代价变长', async () => {
    const app = await buildApp(makeRegistry());

    // 直连 1 → 2 → 3
    const free = await app.inject({
      method: 'GET',
      url: '/api/path?mode=car&from=114.300,30.500&to=114.310,30.510',
    });
    expect(free.statusCode).toBe(200);
    const freeBody = free.json() as { nodeIds: number[]; distance: number };
    expect(freeBody.nodeIds).toEqual([1, 2, 3]);

    // 禁止「way100(1→2) 转 way200(2→3)」
    const turns = (
      await app.inject({ method: 'GET', url: '/api/intersections/2/turns?mode=car' })
    ).json() as IntersectionTurns;
    const leftTurn = turns.turns.find((t) => t.fromWayId === 100 && t.toWayId === 200)!;
    expect(leftTurn).toBeDefined();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/intersections/2/turns?mode=car',
      payload: { forbidden: [{ fromEdge: leftTurn.fromEdge, toEdge: leftTurn.toEdge }] },
    });
    expect(put.statusCode).toBe(200);

    // 绕行：1 → 2 → 4 → 2 → 3，中心节点访问两次，代价变长
    const restricted = await app.inject({
      method: 'GET',
      url: '/api/path?mode=car&from=114.300,30.500&to=114.310,30.510',
    });
    expect(restricted.statusCode).toBe(200);
    const restrictedBody = restricted.json() as { nodeIds: number[]; distance: number };
    expect(restrictedBody.nodeIds).toEqual([1, 2, 4, 2, 3]);
    expect(restrictedBody.distance).toBeGreaterThan(freeBody.distance);

    await app.close();
  });

  it('非法 mode 返回 400', async () => {
    const app = await buildApp(makeRegistry());
    const res = await app.inject({
      method: 'GET',
      url: '/api/path?mode=plane&from=114.300,30.500&to=114.310,30.510',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

/* ---------- 运行时缓存 ---------- */

describe('ModalRuntimeRegistry', () => {
  it('LRU 容量为 1 时切换模态会重建运行时', () => {
    const registry = makeRegistry(1);
    const car = registry.runtime('car');
    expect(registry.runtime('car')).toBe(car);
    registry.runtime('walk');
    expect(registry.runtime('car')).not.toBe(car);
  });

  it('GeoJSON 序列化结果与运行时缓存独立,可复用', () => {
    const registry = makeRegistry(1);
    const first = registry.featuresJson('car');
    expect(registry.featuresJson('car')).toBe(first);
    expect(JSON.parse(first).features.length).toBeGreaterThan(0);
  });

  it('派生数据缺少 Sprint2 字段时不构建运行时', () => {
    const network = makeNetwork();
    network.dataWarnings = ['派生文件缺少Sprint2数据，请重新运行prepare:data以保留关系与POI'];
    const registry = createModalRuntimeRegistry(network, {
      databasePath: databasePath(),
      dataset: 'test',
    });
    expect(registry.ready).toBe(false);
    expect(() => registry.runtime('car')).toThrow(/Sprint2/);
  });
});

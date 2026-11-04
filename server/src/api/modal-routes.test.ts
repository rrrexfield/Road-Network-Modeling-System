import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { IntersectionTurns, RoadFeatureCollection } from '@gisalgo/shared';
import type { LoadedNetwork } from '../io/loader.js';
import { registerRoutes } from './routes.js';
import { mapTurnError, parseMode, parseNodeId, parseSetTurnsRequest } from './modal-routes.js';
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
  const app = Fastify();
  await registerRoutes(
    app,
    makeNetwork(),
    { nodeCount: NODES.size, edgeCount: 6, wayCount: WAYS.length },
    undefined,
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

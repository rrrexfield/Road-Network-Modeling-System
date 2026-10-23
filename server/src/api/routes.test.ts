import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { Graph } from '../graph/index.js';
import type { LoadedNetwork } from '../io/loader.js';
import { parseLonLat, registerRoutes, snapToNode } from './routes.js';

/** 1 → 2 → 3 一条双向直线；9 是孤立节点，用于不可达用例。 */
const NODES = new Map<number, [number, number]>([
  [1, [30.5, 114.3]],
  [2, [30.5, 114.31]],
  [3, [30.5, 114.32]],
  [9, [30.6, 114.4]],
]);

const EDGES: RoadEdge[] = [
  { id: 10, from: 1, to: 2, wayId: 100 },
  { id: 11, from: 2, to: 1, wayId: 100 },
  { id: 12, from: 2, to: 3, wayId: 100 },
  { id: 13, from: 3, to: 2, wayId: 100 },
];

const NETWORK = {
  meta: {
    source: 'test',
    generatedAt: '2026-10-23T00:00:00.000Z',
    nodeCount: 4,
    wayCount: 1,
    segmentCount: 2,
  },
  nodes: NODES,
  ways: [],
  geojson: { type: 'FeatureCollection', features: [] },
} as unknown as LoadedNetwork;

async function buildApp() {
  const app = Fastify();
  await app.register(websocket);
  await registerRoutes(
    app,
    NETWORK,
    { nodeCount: 4, edgeCount: 4, wayCount: 1 },
    { graph: new Graph(NODES, EDGES), wayHighway: new Map([[100, 'primary']]) },
  );
  return app;
}

describe('parseLonLat', () => {
  it('解析合法坐标', () => {
    expect(parseLonLat('114.3,30.5')).toEqual([114.3, 30.5]);
  });

  it('缺参数返回 null', () => {
    expect(parseLonLat(undefined)).toBeNull();
  });

  it('格式错误返回 null', () => {
    expect(parseLonLat('114.3')).toBeNull();
  });

  it('坐标越界返回 null', () => {
    expect(parseLonLat('200,30')).toBeNull();
  });
});

describe('snapToNode', () => {
  it('吸附到最近的节点', () => {
    const graph = new Graph(NODES, EDGES);
    expect(snapToNode(graph, 114.3105, 30.5002)).toBe(2);
  });
});

describe('GET /api/path', () => {
  it('返回路径、边序列与折线', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/path?from=114.300,30.500&to=114.320,30.500',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      nodeIds: number[];
      edgeIds: number[];
      coordinates: [number, number][];
      from: [number, number];
      to: [number, number];
      distance: number;
    };
    expect(body.nodeIds).toEqual([1, 2, 3]);
    expect(body.edgeIds).toEqual([10, 12]);
    expect(body.coordinates).toHaveLength(3);
    // Graph 内部用 Float32Array 存坐标，存在极小精度损失，故用近似比较
    expect(body.from[0]).toBeCloseTo(114.3, 3);
    expect(body.to[0]).toBeCloseTo(114.32, 3);
    expect(body.distance).toBeGreaterThan(0);

    await app.close();
  });

  it('缺少 to 参数返回 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/path?from=114.300,30.500',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('起点终点不可达返回 404', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/path?from=114.300,30.500&to=114.400,30.600',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { NetworkStats, TopologyStats, WeightProfileResponse } from '@gisalgo/shared';
import { registerWeightRoutes } from './routes.js';

const nodes = new Map<number, [number, number]>([
  [1, [30, 114]],
  [2, [30.01, 114.01]],
]);
const edges = [
  { id: 0, from: 1, to: 2, wayId: 7 },
  { id: 1, from: 2, to: 1, wayId: 7 },
];
const wayHighway = new Map([[7, 'primary']]);
const topology: TopologyStats = {
  nodeCount: 2,
  edgeCount: 2,
  connectedComponentCount: 1,
  largestComponentSize: 2,
  danglingNodeCount: 2,
  isolatedNodeCount: 0,
  averageDegree: 2,
  degreeDistribution: new Map([[2, 2]]),
};

/** 启动临时端口的真实 HTTP 服务;inject 在当前 Node 22.11 + light-my-request 下不可用。 */
async function withApp<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = Fastify();
  await app.register(registerWeightRoutes, {
    network: { nodes, edges, wayHighway, edgeLength: () => 100 },
    topology,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    await app.close();
    throw new Error('无法获取测试服务端端口');
  }
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

describe('registerWeightRoutes', () => {
  it('serves the default weight profile', async () => {
    await withApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/weights/profile`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as WeightProfileResponse;
      expect(body.default).toEqual({ metric: 'time', speedFactor: 1, speedOverridesKmh: {} });
      expect(body.speedTable['primary']).toBe(60);
    });
  });

  it('serves stats with injected edge lengths and topology', async () => {
    await withApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/stats`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as NetworkStats;
      expect(body.nodeCount).toBe(2);
      expect(body.edgeCount).toBe(2);
      expect(body.wayCount).toBe(1);
      expect(body.totalLengthMeters).toBe(200);
      expect(body.topologySource).toBe('graph-engine');
      expect(body.topology?.degreeDistribution).toEqual([{ degree: 2, count: 2 }]);
      // 200 m @ primary 60 km/h = 12 s
      expect(body.totalTravelSeconds).toBeCloseTo(12, 6);
    });
  });

  it('applies speedFactor and per-highway overrides, with caching', async () => {
    await withApp(async (baseUrl) => {
      const fast = (await (
        await fetch(`${baseUrl}/api/stats?speedFactor=2`)
      ).json()) as NetworkStats;
      expect(fast.profile.speedFactor).toBe(2);
      expect(fast.totalTravelSeconds).toBeCloseTo(6, 6);

      const override = (await (
        await fetch(`${baseUrl}/api/stats?speedKmh=primary:36`)
      ).json()) as NetworkStats;
      expect(override.profile.speedOverridesKmh).toEqual({ primary: 36 });
      expect(override.totalTravelSeconds).toBeCloseTo(20, 6);

      const cached = (await (
        await fetch(`${baseUrl}/api/stats?speedKmh=primary:36`)
      ).json()) as NetworkStats;
      expect(cached).toEqual(override);
    });
  });
});

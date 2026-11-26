import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { NetworkStats, TopologyStats, WeightProfileResponse } from '@gisalgo/shared';
import { parseTrafficParams, registerWeightRoutes } from './routes.js';
import { normalizeCongestionProfile, type TrafficEvent } from './traffic.js';
import type { AccessibilityReport } from './accessibility.js';

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
    network: {
      nodes,
      edges,
      wayHighway,
      edgeLength: () => 100,
      // 属性完整率的 way 标签表为必填输入(issue #47 收紧契约)。
      ways: new Map([[7, { highway: 'primary', tags: { name: '测试路' } }]]),
    },
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
      // 属性完整率随统计一并下发(issue #47 收紧为必填字段)
      expect(body.attributeCompleteness.name).toEqual({ filled: 1, total: 1, ratio: 1 });
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

describe('parseTrafficParams(Sprint 3 · issue #65)', () => {
  const preset: TrafficEvent[] = [{ wayIds: [7], kind: 'closure' }];

  it('传入 hour 启用拥堵(默认曲线);非法钟点返回 undefined', () => {
    expect(parseTrafficParams({ hour: '8.5' }, preset)).toEqual({
      hourOfDay: 8.5,
      congestion: normalizeCongestionProfile(undefined),
      events: preset,
    });
    expect(parseTrafficParams({ hour: '25' })).toBeUndefined();
    expect(parseTrafficParams({ hour: 'abc' })).toBeUndefined();
    expect(parseTrafficParams({})).toBeUndefined();
  });

  it('events=off 关闭预置事件;congestion=off 关闭拥堵只留事件窗口', () => {
    const withoutEvents = parseTrafficParams({ hour: '9', events: 'off' }, preset)!;
    expect(withoutEvents.events).toBeUndefined();
    const withoutCongestion = parseTrafficParams({ hour: '9', congestion: 'off' }, preset)!;
    expect(withoutCongestion.congestion).toBeUndefined();
    expect(withoutCongestion.congestionDisabled).toBe(true);
    expect(withoutCongestion.events).toEqual(preset);
  });

  it('无预置事件时 events 不出现在结果里', () => {
    const conditions = parseTrafficParams({ hour: '9' })!;
    expect(conditions.events).toBeUndefined();
  });
});

describe('Sprint 3 路由', () => {
  it('/api/weights/traffic 下发默认拥堵曲线与预置事件', async () => {
    await withApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/weights/traffic`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        congestion: { slotMinutes: number; curve: unknown[] };
        events: unknown[];
      };
      expect(body.congestion.slotMinutes).toBe(30);
      expect(body.congestion.curve.length).toBeGreaterThan(0);
      expect(body.events).toEqual([]);
    });
  });

  it('/api/stats 传 hour 后时间口径变化、里程口径不变(可复现)', async () => {
    await withApp(async (baseUrl) => {
      const base = (await (await fetch(`${baseUrl}/api/stats`)).json()) as NetworkStats;
      const peak = (await (await fetch(`${baseUrl}/api/stats?hour=8.5`)).json()) as NetworkStats;
      const peakAgain = (await (
        await fetch(`${baseUrl}/api/stats?hour=8.5`)
      ).json()) as NetworkStats;
      expect(peak.totalTravelSeconds).toBeGreaterThan(base.totalTravelSeconds);
      expect(peak.totalLengthMeters).toBe(base.totalLengthMeters);
      expect(peak.totalTravelSeconds).toBe(peakAgain.totalTravelSeconds); // 确定性
      expect(peak.edgeCount).toBe(base.edgeCount); // 事件不计入统计
    });
  });

  it('/api/accessibility:正常请求、缺 origin 400、未知起点 404', async () => {
    await withApp(async (baseUrl) => {
      const ok = await fetch(`${baseUrl}/api/accessibility?origin=1&budget=5`);
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as AccessibilityReport & {
        notes?: Record<string, string>;
      };
      expect(body.originNode).toBe(1);
      expect(body.budgetSeconds).toBe(300);
      expect(body.reachableNodeCount).toBe(2); // 两节点小网,5 分钟足够
      expect(body.byHighway[0]!.lengthMeters).toBeCloseTo(200, 6);
      expect(body.notes).toBeDefined();

      const missing = await fetch(`${baseUrl}/api/accessibility`);
      expect(missing.status).toBe(400);

      const unknown = await fetch(`${baseUrl}/api/accessibility?origin=42`);
      expect(unknown.status).toBe(404);
    });
  });

  it('/api/accessibility 支持 mode 与确定性复现', async () => {
    await withApp(async (baseUrl) => {
      const a = await (await fetch(`${baseUrl}/api/accessibility?origin=1&mode=walk`)).json();
      const b = await (await fetch(`${baseUrl}/api/accessibility?origin=1&mode=walk`)).json();
      expect(a).toEqual(b);
      expect((a as AccessibilityReport).mode).toBe('walk');
    });
  });
});

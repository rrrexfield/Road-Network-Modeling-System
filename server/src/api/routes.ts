/**
 * REST + WebSocket 路由。
 */
import type { FastifyInstance } from 'fastify';
import type { HealthResponse, PathResponse, TravelMode, WSMessage } from '@gisalgo/shared';
import type { LoadedNetwork } from '../io/loader.js';
import {
  dijkstra,
  dijkstraWithTurnRestrictions,
  type EdgeWeightFn,
  type Graph,
  type ReadonlyAdjacency,
  type TurnRestrictionPredicate,
} from '../graph/index.js';
import {
  createModeEdgeWeight,
  normalizeWeightProfile,
  parseWeightProfileParams,
} from '../weights/index.js';
import { registerModalRoutes, parseMode } from './modal-routes.js';
import { findMultimodalPath, parseModeSequence, snapToNode } from './multimodal-path.js';
import type { ModalRuntimeRegistry } from './modal-runtime.js';

interface WsLike {
  send(data: string): void;
  on(event: string, cb: (data: unknown) => void): void;
}

/** 当前装载图的规模计数(有向边口径,与 shared 的 HealthResponse 一致)。 */
export interface NetworkCounts {
  nodeCount: number;
  edgeCount: number;
  wayCount: number;
}

/** 路径查询所需的图依赖;不传则不注册 /api/path。 */
export interface PathDeps {
  graph: Graph;
  /** wayId → highway 等级,供时间权重查表 */
  wayHighway: ReadonlyMap<number, string>;
}

/** 解析 "lon,lat" 形式的查询参数;非法返回 null。 */
export function parseLonLat(raw: string | undefined): [number, number] | null {
  if (raw === undefined) return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

/**
 * 把经纬度吸附到最近的图节点。
 *
 * 实现位于 `multimodal-path.ts`(跨模态路径同样需要吸附),此处转出以保持既有引用不变。
 */
export { snapToNode } from './multimodal-path.js';

export async function registerRoutes(
  app: FastifyInstance,
  network: LoadedNetwork,
  counts: NetworkCounts,
  pathDeps?: PathDeps,
  modal?: ModalRuntimeRegistry,
): Promise<void> {
  // 统一错误形状:契约规定错误响应为 { error: { message } }
  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    const status = typeof statusCode === 'number' ? statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, '请求处理失败');
      return reply.code(500).send({ error: { message: '服务器内部错误' } });
    }
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(status).send({ error: { message } });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { message: `未知路由:${request.method} ${request.url}` } }),
  );

  app.get('/api/health', (): HealthResponse => ({
    status: 'ok',
    nodeCount: counts.nodeCount,
    edgeCount: counts.edgeCount,
    wayCount: counts.wayCount,
    uptime: Math.round(process.uptime()),
  }));

  // 不带 mode 时行为与作业一完全一致;带 mode 时返回该模态实际可通行的道路
  app.get('/api/network', (request, reply) => {
    const raw = (request.query as { mode?: unknown }).mode;
    if (raw === undefined) return network.geojson;
    const mode = parseMode(raw);
    if (mode === null) {
      return reply
        .code(400)
        .send({ error: { message: 'mode 必须是 car / walk / bike / bus 之一' } });
    }
    if (modal === undefined) {
      return reply.code(501).send({ error: { message: '多模态路网未启用' } });
    }
    if (!modal.ready) {
      return reply
        .code(503)
        .send({ error: { message: modal.unavailableReason ?? '派生数据不可用' } });
    }
    // 预先序列化的 JSON 字符串:避免每次请求重复 stringify 整个路网
    return reply.type('application/json').send(modal.featuresJson(mode));
  });

  if (pathDeps !== undefined) {
    const { graph: baseGraph, wayHighway: baseWayHighway } = pathDeps;

    app.get('/api/path', (request, reply) => {
      const query = request.query as {
        from?: string;
        to?: string;
        metric?: string;
        mode?: unknown;
        modes?: unknown;
      };

      const fromPoint = parseLonLat(query.from);
      const toPoint = parseLonLat(query.to);
      if (fromPoint === null || toPoint === null) {
        return reply.code(400).send({
          error: { message: 'from / to 需为 "经度,纬度"，例如 from=114.305,30.593' },
        });
      }

      // 权重配置:优化目标由 metric 决定(缺省最短距离,与作业一一致);
      // 速度系数与等级限速覆盖来自查询串(issue #45:权重面板的全局参数作用于路径与统计)。
      const profile = normalizeWeightProfile({
        ...parseWeightProfileParams(query as Record<string, unknown>),
        metric: query.metric === 'time' ? ('time' as const) : ('distance' as const),
      });

      // 跨模态路径(issue #34):modes 是有序模态序列,例如 modes=car,walk。
      // 与单模态的 mode 参数互斥——两者语义不同,混用无法判定该走哪套路网。
      if (query.modes !== undefined) {
        if (query.mode !== undefined) {
          return reply
            .code(400)
            .send({ error: { message: 'mode 与 modes 不可同时使用:mode 是单模态,modes 是跨模态序列' } });
        }
        const modes = parseModeSequence(query.modes);
        if (modes === null || modes.length < 2) {
          return reply.code(400).send({
            error: { message: 'modes 需为至少两个不同的交通模态,例如 modes=car,walk' },
          });
        }
        if (modal === undefined) {
          return reply.code(501).send({ error: { message: '多模态路网未启用' } });
        }
        if (!modal.ready) {
          return reply
            .code(503)
            .send({ error: { message: modal.unavailableReason ?? '派生数据不可用' } });
        }
        try {
          const result = findMultimodalPath(modes, fromPoint, toPoint, {
            registry: modal,
            network,
            profile,
          });
          if (result === null) {
            return reply.code(404).send({
              error: { message: '起点与终点之间不存在可行的跨模态路径(无可用换乘连接或不可达)' },
            });
          }
          return result.body;
        } catch (error) {
          request.log.error({ err: error }, '跨模态路径求解失败');
          return reply.code(500).send({ error: { message: '跨模态路径求解失败' } });
        }
      }

      // 缺省走基础图（无禁转，与作业一一致）；显式给 mode 走该模态子图并应用禁转判定。
      // 禁转边对与边 ID 都只在所属模态内有效，故必须用同一模态的图 + 禁转服务（issue #38）。
      let activeGraph: ReadonlyAdjacency = baseGraph;
      let activeWayHighway = baseWayHighway;
      // 边权按当前模态取速度：缺省为 car（基础图沿用汽车限速表，行为不变），
      // 显式 mode 时走该模态的速度表（issue #47）。
      let activeMode: TravelMode = 'car';
      let isTurnForbidden: TurnRestrictionPredicate | undefined;
      if (query.mode !== undefined) {
        const mode = parseMode(query.mode);
        if (mode === null) {
          return reply
            .code(400)
            .send({ error: { message: 'mode 必须是 car / walk / bike / bus 之一' } });
        }
        if (modal === undefined) {
          return reply.code(501).send({ error: { message: '多模态路网未启用' } });
        }
        if (!modal.ready) {
          return reply
            .code(503)
            .send({ error: { message: modal.unavailableReason ?? '派生数据不可用' } });
        }
        const runtime = modal.runtime(mode);
        activeGraph = runtime.graph;
        activeWayHighway = runtime.wayHighway;
        activeMode = mode;
        isTurnForbidden = (via, from, to) => runtime.service.isForbidden(via, from, to);
      }

      const startId = snapToNode(activeGraph, fromPoint[0], fromPoint[1]);
      const endId = snapToNode(activeGraph, toPoint[0], toPoint[1]);
      if (startId === null || endId === null) {
        return reply.code(404).send({ error: { message: '路网中没有可吸附的节点' } });
      }

      // metric=time 走 D 的时间权重(里程/有效限速),distance 走里程;
      // 速度来源按当前模态取值(issue #47):car 沿用汽车限速表,walk/bike/bus 用模态速度表。
      const weight: EdgeWeightFn = createModeEdgeWeight(
        { nodes: network.nodes, wayHighway: activeWayHighway },
        activeMode,
        profile,
      );

      const result =
        isTurnForbidden === undefined
          ? dijkstra(baseGraph, startId, endId, weight)
          : dijkstraWithTurnRestrictions(activeGraph, startId, endId, isTurnForbidden, weight);

      // 不可达时返回 Infinity + 空序列;REST 层转成 404 而不是下发 Infinity
      if (result.nodeIds.length === 0) {
        return reply.code(404).send({ error: { message: '起点与终点之间不可达' } });
      }

      const coordinates: [number, number][] = [];
      for (const nodeId of result.nodeIds) {
        const c = activeGraph.coordinates(nodeId);
        if (c !== undefined) coordinates.push([c[1], c[0]]);
      }

      const start = activeGraph.coordinates(startId);
      const end = activeGraph.coordinates(endId);
      if (start === undefined || end === undefined) {
        return reply.code(500).send({ error: { message: '节点坐标缺失' } });
      }

      const body: PathResponse = {
        distance: result.distance,
        nodeIds: result.nodeIds,
        edgeIds: result.edgeIds,
        from: [start[1], start[0]],
        to: [end[1], end[0]],
        coordinates,
      };
      return body;
    });
  }

  if (modal !== undefined) {
    // 作业二:转换点与转向限制读写(issue #24 冻结的契约)
    await registerModalRoutes(app, modal);
  }

  app.get('/ws', { websocket: true }, (connection) => {
    // @fastify/websocket v11 直接传入 WebSocket;v10 为 SocketStream 包装,此处兼容两种形态
    const ws: WsLike =
      (connection as unknown as { socket?: WsLike }).socket ?? (connection as unknown as WsLike);

    const hello: WSMessage = {
      type: 'hello',
      payload: {
        nodeCount: counts.nodeCount,
        edgeCount: counts.edgeCount,
        wayCount: counts.wayCount,
      },
    };
    ws.send(JSON.stringify(hello));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as WSMessage;
        if (msg.type === 'ping') {
          const pong: WSMessage = { type: 'pong', payload: { t: msg.payload.t } };
          ws.send(JSON.stringify(pong));
        }
      } catch {
        // 忽略非 JSON 消息
      }
    });
  });
}

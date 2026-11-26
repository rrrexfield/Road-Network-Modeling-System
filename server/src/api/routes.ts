/**
 * REST + WebSocket 路由。
 */
import type { FastifyInstance } from 'fastify';
import type {
  CompressionReportResponse,
  HealthResponse,
  PathResponse,
  PathResult,
  TrafficEvent,
  TravelMode,
  WSMessage,
} from '@gisalgo/shared';
import type { LoadedNetwork } from '../io/loader.js';
import {
  compressEdgeWeight,
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
  parseTrafficParams,
  parseWeightProfileParams,
} from '../weights/index.js';
import { registerModalRoutes, parseMode } from './modal-routes.js';
import { findMultimodalPath, parseModeSequence, snapToNode } from './multimodal-path.js';
import { type CompressionView, type ModalRuntimeRegistry } from './modal-runtime.js';

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
  /**
   * 服务端预置事件场景（Sprint 3 · issue #65）。
   *
   * 与 `/api/stats` 的 `registerWeightRoutes({ events })` 共用同一份场景；
   * 缺省或空数组表示没有预置事件（查询串 `hour=` 仍启用拥堵时间槽）。
   */
  trafficEvents?: readonly TrafficEvent[];
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
 * 解析 `compressed` 查询参数（作业三）。
 *
 * @returns 缺省 `false`；`1/true` 为真、`0/false` 为假；其它值返回 null（由调用方报 400）。
 * @remarks 用显式白名单而不是 truthy 判断，避免 `compressed=yes` 被静默当作关闭。
 */
export function parseCompressedFlag(raw: unknown): boolean | null {
  if (raw === undefined) return false;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

/** 首次构建压缩图时记录规模与耗时（命中缓存不打印，避免请求日志噪声）。 */
function logCompressionBuild(
  log: { info: (message: string) => void },
  mode: TravelMode,
  view: CompressionView,
): void {
  const { stats } = view;
  log.info(
    `模态 ${mode} 压缩图构建完成: ${view.buildMs} ms, ` +
      `节点 ${stats.originalNodeCount.toLocaleString()} → ${stats.compressedNodeCount.toLocaleString()}, ` +
      `有向边 ${stats.originalEdgeCount.toLocaleString()} → ${stats.compressedEdgeCount.toLocaleString()}, ` +
      `保留节点 ${view.protectedNodeCount.toLocaleString()}`,
  );
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
        compressed?: unknown;
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

      // 交通条件(Sprint 3 · issue #65):`hour=` 启用拥堵时间槽,缺省不启用(零行为变化);
      // 与 /api/stats 共用 parseTrafficParams 的解析口径。
      const traffic = parseTrafficParams(query as Record<string, unknown>, pathDeps.trafficEvents);

      // 压缩图开关(作业三 · issue #69):只对单模态 mode 有意义,基础图没有运行时/版本/保留集。
      const compressedRequested = parseCompressedFlag(query.compressed);
      if (compressedRequested === null) {
        return reply.code(400).send({ error: { message: 'compressed 只接受 1/0/true/false' } });
      }
      if (compressedRequested && query.modes !== undefined) {
        return reply
          .code(400)
          .send({ error: { message: 'compressed 不能与 modes 同时使用:压缩图只用于单模态路径' } });
      }
      if (compressedRequested && query.mode === undefined) {
        return reply
          .code(400)
          .send({ error: { message: 'compressed 需要同时指定 mode:基础图没有模态压缩图' } });
      }

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
      let compressionView: CompressionView | undefined;
      let turnVersion = 0;
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
        if (compressedRequested) {
          const { view, fresh } = runtime.compressedView();
          compressionView = view;
          turnVersion = view.turnVersion;
          if (fresh) logCompressionBuild(request.log, mode, view);
        }
      }

      const startId = snapToNode(activeGraph, fromPoint[0], fromPoint[1]);
      const endId = snapToNode(activeGraph, toPoint[0], toPoint[1]);
      if (startId === null || endId === null) {
        return reply.code(404).send({ error: { message: '路网中没有可吸附的节点' } });
      }

      // metric=time 走 D 的时间权重(里程/有效限速),distance 走里程;
      // 速度来源按当前模态取值(issue #47):car 沿用汽车限速表,walk/bike/bus 用模态速度表。
      // traffic 缺省为 undefined,与 Sprint 2 逐位一致。
      const weight: EdgeWeightFn = createModeEdgeWeight(
        { nodes: network.nodes, wayHighway: activeWayHighway },
        activeMode,
        profile,
        traffic,
      );

      let result: PathResult;
      let responseNodeIds: number[];
      let responseEdgeIds: number[];
      let compressionApplied = false;
      if (
        compressionView !== undefined &&
        compressionView.graph.hasNode(startId) &&
        compressionView.graph.hasNode(endId)
      ) {
        // 压缩图:合成边 id 不能直接进禁转表,映射为压缩边内首/末原图边
        // (via 节点全部在保留集,压缩边不会跨过 via)。
        const cg = compressionView.graph;
        const forbidden: TurnRestrictionPredicate = (via, fromEdgeId, toEdgeId) =>
          isTurnForbidden!(
            via,
            cg.edge(fromEdgeId)!.originalEdgeIds.at(-1)!,
            cg.edge(toEdgeId)!.originalEdgeIds[0]!,
          );
        result = dijkstraWithTurnRestrictions(
          cg,
          startId,
          endId,
          forbidden,
          compressEdgeWeight(cg, weight) as EdgeWeightFn,
        );
        const expanded = cg.expandPath(result.nodeIds, result.edgeIds);
        responseNodeIds = expanded.nodeIds;
        responseEdgeIds = expanded.edgeIds;
        compressionApplied = true;
      } else {
        // 端点落在被压缩节点上时透明回退原图,避免吸附到很远的保留节点导致路径失真。
        result =
          isTurnForbidden === undefined
            ? dijkstra(baseGraph, startId, endId, weight)
            : dijkstraWithTurnRestrictions(activeGraph, startId, endId, isTurnForbidden, weight);
        responseNodeIds = result.nodeIds;
        responseEdgeIds = result.edgeIds;
      }

      // 不可达时返回 Infinity + 空序列;REST 层转成 404 而不是下发 Infinity
      if (result.nodeIds.length === 0) {
        return reply.code(404).send({ error: { message: '起点与终点之间不可达' } });
      }

      const coordinates: [number, number][] = [];
      for (const nodeId of responseNodeIds) {
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
        nodeIds: responseNodeIds,
        edgeIds: responseEdgeIds,
        from: [start[1], start[0]],
        to: [end[1], end[0]],
        coordinates,
      };
      if (compressedRequested) {
        body.compression = { applied: compressionApplied, turnVersion };
      }
      return body;
    });
  }

  // 作业三(issue #69):压缩图统计。首次请求会触发该模态的压缩构建(约数秒),
  // 之后按 (mode, 禁转表版本号) 命中运行时实例上的缓存。
  app.get('/api/compression', (request, reply) => {
    if (modal === undefined) {
      return reply.code(501).send({ error: { message: '多模态路网未启用' } });
    }
    const mode = parseMode((request.query as { mode?: unknown }).mode);
    if (mode === null) {
      return reply
        .code(400)
        .send({ error: { message: 'mode 必须是 car / walk / bike / bus 之一' } });
    }
    if (!modal.ready) {
      return reply
        .code(503)
        .send({ error: { message: modal.unavailableReason ?? '派生数据不可用' } });
    }
    const { view, fresh } = modal.runtime(mode).compressedView();
    if (fresh) logCompressionBuild(request.log, mode, view);
    const body: CompressionReportResponse = {
      mode,
      turnVersion: view.turnVersion,
      protectedNodeCount: view.protectedNodeCount,
      buildMs: view.buildMs,
      cached: !fresh,
      stats: view.stats,
    };
    return body;
  });

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

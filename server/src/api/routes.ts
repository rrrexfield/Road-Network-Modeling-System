/**
 * REST + WebSocket 路由。
 */
import type { FastifyInstance } from 'fastify';
import type { HealthResponse, PathResponse, WSMessage } from '@gisalgo/shared';
import type { LoadedNetwork } from '../io/loader.js';
import { dijkstra, type EdgeWeightFn, type Graph } from '../graph/index.js';
import { DEFAULT_WEIGHT_PROFILE, createEdgeWeight } from '../weights/index.js';

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
 * 线性扫描全部节点:武汉数据 62.8 万节点,实测在毫秒级,满足演示需要。
 * 若后续成为瓶颈,可替换为 G3 的空间索引。
 */
export function snapToNode(graph: Graph, lon: number, lat: number): number | null {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const id of graph.nodes()) {
    const c = graph.coordinates(id);
    if (c === undefined) continue;
    // c 是 [lat, lon];经度差要乘 cos(lat) 才能和纬度差同尺度比较
    const dy = c[0] - lat;
    const dx = (c[1] - lon) * cosLat;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

export async function registerRoutes(
  app: FastifyInstance,
  network: LoadedNetwork,
  counts: NetworkCounts,
  pathDeps?: PathDeps,
): Promise<void> {
  app.get('/api/health', (): HealthResponse => ({
    status: 'ok',
    nodeCount: counts.nodeCount,
    edgeCount: counts.edgeCount,
    wayCount: counts.wayCount,
    uptime: Math.round(process.uptime()),
  }));

  app.get('/api/network', () => network.geojson);

  if (pathDeps !== undefined) {
    const { graph, wayHighway } = pathDeps;

    app.get('/api/path', (request, reply) => {
      const query = request.query as { from?: string; to?: string; metric?: string };

      const fromPoint = parseLonLat(query.from);
      const toPoint = parseLonLat(query.to);
      if (fromPoint === null || toPoint === null) {
        return reply.code(400).send({
          error: { message: 'from / to 需为 "经度,纬度"，例如 from=114.305,30.593' },
        });
      }

      const startId = snapToNode(graph, fromPoint[0], fromPoint[1]);
      const endId = snapToNode(graph, toPoint[0], toPoint[1]);
      if (startId === null || endId === null) {
        return reply.code(404).send({ error: { message: '路网中没有可吸附的节点' } });
      }

      // metric=time 走 D 的时间权重(里程/有效限速),distance 走预计算边长
      const profile = {
        ...DEFAULT_WEIGHT_PROFILE,
        metric: query.metric === 'time' ? ('time' as const) : ('distance' as const),
      };
      const weight: EdgeWeightFn = createEdgeWeight(
        { nodes: network.nodes, wayHighway },
        profile,
      );

      const result = dijkstra(graph, startId, endId, weight);

      // 不可达时 dijkstra 返回 Infinity + 空序列;REST 层转成 404 而不是下发 Infinity
      if (result.nodeIds.length === 0) {
        return reply.code(404).send({ error: { message: '起点与终点之间不可达' } });
      }

      const coordinates: [number, number][] = [];
      for (const nodeId of result.nodeIds) {
        const c = graph.coordinates(nodeId);
        if (c !== undefined) coordinates.push([c[1], c[0]]);
      }

      const start = graph.coordinates(startId);
      const end = graph.coordinates(endId);
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
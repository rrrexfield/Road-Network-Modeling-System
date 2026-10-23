/**
 * REST + WebSocket 路由。
 */
import type { FastifyInstance } from 'fastify';
import type { HealthResponse, WSMessage } from '@gisalgo/shared';
import type { LoadedNetwork } from '../io/loader.js';

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

export async function registerRoutes(
  app: FastifyInstance,
  network: LoadedNetwork,
  counts: NetworkCounts,
): Promise<void> {
  app.get('/api/health', (): HealthResponse => ({
    status: 'ok',
    nodeCount: counts.nodeCount,
    edgeCount: counts.edgeCount,
    wayCount: counts.wayCount,
    uptime: Math.round(process.uptime()),
  }));

  app.get('/api/network', () => network.geojson);

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

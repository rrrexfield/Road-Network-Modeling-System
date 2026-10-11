/**
 * 服务端入口:加载路网到内存,注册路由,监听 3000。
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { loadNetwork } from './io/loader.js';
import { registerRoutes } from './api/routes.js';

const DATA_URL = new URL('../../data/derived/wuhan-roads.json', import.meta.url);
const PORT = 3000;

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const network = loadNetwork(DATA_URL);
  app.log.info(
    `路网载入完成: nodes=${network.nodes.size.toLocaleString()} ` +
      `edges=${network.edges.length.toLocaleString()} ` +
      `ways=${network.meta.wayCount.toLocaleString()}`,
  );

  await registerRoutes(app, network);
  await app.listen({ port: PORT, host: '127.0.0.1' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

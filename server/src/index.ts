/**
 * 服务端入口:装载路网 → 构建有向拓扑与图 → 注册 REST/WS,监听 3000。
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { fileURLToPath } from 'node:url';
import { loadNetwork } from './io/loader.js';
import { registerRoutes } from './api/routes.js';
import { createModalRuntimeRegistry, setActiveModalRuntimeRegistry } from './api/index.js';
import { buildTopology, createTopologyReport } from './topology/index.js';
import { Graph, computeTopologyStats } from './graph/index.js';
import { registerWeightRoutes } from './weights/index.js';

const DATA_URL = new URL('../../data/derived/wuhan-roads.json', import.meta.url);
const TURNS_DB_PATH = fileURLToPath(
  new URL('../../data/derived/wuhan-turns.sqlite', import.meta.url),
);
const PORT = 3000;

async function main(): Promise<void> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const network = loadNetwork(DATA_URL);
  app.log.info(
    `路网载入完成: nodes=${network.nodes.size.toLocaleString()} ` +
      `ways=${network.ways.length.toLocaleString()}`,
  );

  const topology = buildTopology(network.nodes, network.ways);
  const graph = new Graph(topology.nodes, topology.edges);
  const topologyStats = computeTopologyStats(graph);
  const wayHighway = new Map([...topology.ways].map(([wayId, way]) => [wayId, way.highway]));
  const report = createTopologyReport(topology);

  app.log.info(
    `拓扑组装完成: nodes=${graph.nodeCount.toLocaleString()} ` +
      `edges=${graph.edgeCount.toLocaleString()} ` +
      `ways=${topology.ways.size.toLocaleString()} ` +
      `issues=${topology.issues.length.toLocaleString()} ` +
      `excludedByDirection=${report.excludedDirectionWays.length.toLocaleString()}`,
  );

  let missingWayHighway = 0;
  for (const edge of topology.edges) {
    if (!wayHighway.has(edge.wayId)) missingWayHighway += 1;
  }
  if (missingWayHighway > 0) {
    app.log.warn(`有 ${missingWayHighway} 条边的 wayId 未找到 highway 映射,统计将按 unknown 兜底`);
  }

  // 作业二:多模态运行时按需构建(装载策略决策见 docs/多模态路网设计.md)
  const modal = createModalRuntimeRegistry(network, {
    databasePath: TURNS_DB_PATH,
    dataset: 'wuhan-current-source',
  });
  setActiveModalRuntimeRegistry(modal);
  if (modal.ready) {
    app.log.info(
      '多模态运行时已就绪:首次请求某模态时才构建该模态子图与禁转表,禁转快照写入 data/derived/wuhan-turns.sqlite',
    );
  } else {
    app.log.warn(`多模态接口暂不可用:${modal.unavailableReason ?? '派生数据不可用'}`);
  }

  await registerRoutes(
    app,
    network,
    {
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
      wayCount: topology.ways.size,
    },
    { graph, wayHighway },
    modal,
  );
  await app.register(registerWeightRoutes, {
    network: {
      nodes: topology.nodes,
      edges: topology.edges,
      wayHighway,
      edgeLength: (edge) => graph.edgeLength(edge.id),
      // 传全量 way 标签表以启用属性完整率(issue #23 / #47);
      // 口径为「按 way 统计」,故不能按参与构边的 way 过滤。
      ways: topology.ways,
    },
    topology: topologyStats,
  });
  

  await app.listen({ port: PORT, host: '127.0.0.1' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

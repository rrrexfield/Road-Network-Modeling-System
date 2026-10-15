# B 第一次作业任务准备（图引擎）

日期：2026-10-14。状态：`server/src/graph/` 模块完成——有向图 `Graph`、最小堆优先队列、Dijkstra + 路径重建、拓扑统计；24 项测试通过，全仓 60 项测试 + typecheck + lint 全绿。尚未接入 loader / 路由（A 组装），契约待 A 冻结。

## 1. 范围

对应立项文档 §4.3 Sprint 1 与 Backlog GE-1/GE-2/GE-3，全部落在 B 唯一修改权目录 `server/src/graph/`。

| 故事 | 内容 | 交付 |
|---|---|---|
| GE-1 | 有向图 Graph：邻接表 + Float32Array 紧凑坐标 + 增删边 | `graph.ts` |
| GE-3 | Dijkstra + 路径重建（优先队列） | `priority-queue.ts`、`dijkstra.ts` |
| GE-2 | 连通分量（并查集）、度分布、悬挂节点 | `components.ts` |

## 2. 与 C 的接口（已在 issue #5 确认记录）

- C 的 `buildTopology()` 返回 `TopologyResult { nodes, edges, ways, issues }`。
- B 的 `Graph` 构造入参直接消费 `TopologyResult.nodes`（`Map<number, [number, number]>`）与 `TopologyResult.edges`（`RoadEdge[]`，`RoadEdge` 来自 `@gisalgo/shared`），**无需适配层**：`new Graph(topo.nodes, topo.edges)`。
- 边 id 由 C 以 `edges.length` 递增生成，唯一且顺序稳定；Graph 按 id 去重。边 id 仅在固定输入顺序与规则下稳定，跨版本不保证，不可作持久化身份（与 C 的契约及 CLAUDE.md 同步区一致）。

## 3. 模块设计

### 3.1 `Graph`（`graph.ts`）

- 内部：`nodeIndex`（id → 连续下标）、`ids`（下标 → id）、`lat/lon: Float32Array`（紧凑坐标）、`outAdj`（出边邻接表）、`inDeg`（入度）、`edgesById`、`edgeLen`（边长缓存）。
- 边数为 `edgesById.size`；出度由邻接表长度推导；`addEdge` 要求端点已存在，`removeEdge` 按边 id 删除；边长在装载时一次预计算（`edgeLength(id)`）。
- 坐标用 Float32 存储：约 7 位有效数字，误差为各向异性——武汉纬度下纬向最坏约 0.11 m、经向最坏约 0.37 m/端点（0.15 m 为典型值），一条边两端累计最坏约 0.7 m，短路段（约 10 m）相对误差可达数个百分点，近邻最短路可能因平局翻转；对渲染与一般路径代价可用。若要更高精度需改为 Float64，届时在契约评审中提出。

### 3.2 `PriorityQueue`（`priority-queue.ts`）

- 二叉最小堆，`push/pop/peek`。Dijkstra 采用**惰性删除**：同一节点可多次入队，已结算节点由 `settled` 集合跳过，故无需 decrease-key。

### 3.3 `dijkstra`（`dijkstra.ts`）

- 签名 `dijkstra(graph, source, target, weight?)` → `PathResult { distance, nodeIds, edgeIds }`。
- 默认边权为端点 Haversine 距离（米）；`weight` 可选参数为 Sprint 3 D 的权重注入预留。
- 源/目标缺失或不可达返回 `distance: Infinity`、空序列；`source === target` 返回距离 0。
- 复杂度 O((V+E) log V)。

### 3.4 拓扑统计（`components.ts`）

- `connectedComponents`：并查集，边视为无向（弱连通分量），返回分量数与最大分量规模。
- `degreeDistribution`：入度 + 出度 → 节点数。
- `danglingNodes`：度 = 1 的节点。
- `computeTopologyStats`：聚合为 `TopologyStats`（含平均度 = 2·边数/节点数）。

## 4. 待 A 冻结的契约（issue #4）

`PathResult` 与 `TopologyStats` 当前定义在 graph 内（代码标 `TODO(契约)`），需 A 提升到 `shared/src/index.ts` 供前端 E（起终点路径高亮）与统计面板消费。

## 5. 测试

- `priority-queue.test.ts`（4）、`graph.test.ts`（5）、`dijkstra.test.ts`（5）、`components.test.ts`（2）、`integration.test.ts`（3），共 24 项。
- `integration.test.ts` 跨模块联调：`buildTopology`（oneway yes/-1/双向）→ `Graph` → `dijkstra`，验证 B↔C 契约实际可用，不依赖 162MB 真实数据。

## 6. 待办 / 风险

- 接入 loader / 路由、暴露 `/api/...` 路径与拓扑报告接口，属 A 的组装职责，待 A 集成。
- 真实武汉数据 smoke test 需 `data/wuhan.json`（教师渠道分发，本地缺失），有数据后补一次全量 `buildTopology → Graph → dijkstra` 耗时与连通性实测。
- 转向限制、多模态、压缩、动态权重均不在本阶段。

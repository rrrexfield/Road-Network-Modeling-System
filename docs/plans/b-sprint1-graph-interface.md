# B 图引擎 Graph 接口说明（供 C 及后续接入方）

对应 issue #2「[C → B] 请提供拓扑构建所需的 Graph 构造接口」。本文档说明 `server/src/graph/` 的公开接口、输入格式、与 C 的 `buildTopology()` 对接方式、职责边界，以及最小调用示例。

## 1. 公开入口

模块公开入口为 `server/src/graph/index.ts`，只经它对外引用，禁止深引用内部文件：

```ts
import { Graph, dijkstra, connectedComponents, computeTopologyStats } from '../graph/index.js';
```

## 2. 输入格式

`Graph` 构造入参：

```ts
new Graph(
  nodes: ReadonlyMap<number, readonly [number, number]>, // OSM 节点 id → [lat, lon]（WGS84）
  edges: readonly RoadEdge[],                             // 有向边
)
```

`RoadEdge` 来自 `@gisalgo/shared`，字段为 `{ id: number; from: number; to: number; wayId: number }`。

**约束**

- 边 `id` 需唯一（Graph 按 id 去重，重复 id 静默跳过）。
- 边的端点必须已存在于 `nodes`（构造时自动登记全部 nodes；运行时 `addEdge` 对缺失端点抛错）。
- 方向语义由上游保证：Graph 只存有向边，不推断单双向。单/双向、motorway/roundabout 默认规则由 C 的 `resolveRoadDirection` / `buildTopology` 负责。

## 3. 与 `buildTopology()` 对接（无需适配层）

C 的 `buildTopology()` 返回 `TopologyResult { nodes, edges, ways, issues }`，其中 `nodes`、`edges` 与上面入参形状一致，直接传入即可：

```ts
import { buildTopology } from '../topology/index.js';
import { Graph, dijkstra } from '../graph/index.js';

const { nodes, edges } = buildTopology(sourceNodes, sourceWays); // C 的产物
const graph = new Graph(nodes, edges);                            // 直接装载，无需转换
const path = dijkstra(graph, fromId, toId);                       // { distance, nodeIds, edgeIds }
```

该对接在 `server/src/graph/integration.test.ts` 已有测试，覆盖双向（默认）、正向单行（oneway=yes）、反向单行（oneway=-1）三类道路，并断言装载后边的方向与数量正确。

## 4. 职责边界（避免与 C 重复实现）

| 模块 | 职责 |
|---|---|
| C `server/src/topology/`、`io/` | 数据转换、方向规则、按节点 id 构边 → 产出 `TopologyResult`。**不建 Graph**。 |
| B `server/src/graph/` | 存储拓扑（Graph）+ 图算法（Dijkstra、连通分量、度统计）。**不做方向规则**。 |
| A `server/src/index.ts`、`api/` | 组装：`buildTopology` → `new Graph` → 注册 API/WS。 |
| D `server/src/weights/` | 边权函数，注入 `dijkstra`（Sprint 3）。 |

## 5. 道路等级 / 距离是否进入 Graph 输入

- **道路等级（highway）不进 Graph 输入**。Graph 只关心拓扑连通；等级、`bridge/tunnel/layer` 等属性通过 `edge.wayId` 查 C 的 `ways` 表获取，供渲染（E）与权重（D）使用。
- **距离不预存**。`dijkstra` 默认以边两端点的 Haversine 距离（米）为边权、现算现用；Sprint 3 起由 D 注入 `weight: (edge) => number` 覆盖。

## 6. 验收对照（issue #2）

- [x] 节点、边输入格式与公开接口已明确（本文档 §2）。
- [x] 最小示例可装载双向/正向单行/反向单行并检查方向与数量（`integration.test.ts`）。
- [x] 调用仅经模块公开入口；`npm run typecheck`、`npm test` 通过。
- [ ] C 确认接口满足接入需要（待 C 在 issue #2 回复）。

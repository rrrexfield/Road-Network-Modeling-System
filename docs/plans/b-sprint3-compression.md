# B 作业三：度-2 节点压缩与压缩图/原图双向映射

2026-11-25；关联 issue #63/#64；基于 main `f9bfe03`。分支 `feature/graph-compression`。

## 1. 交付内容（均在 `server/src/graph/`）

- `compression.ts`：`compressTopology` 度-2 节点压缩 + `CompressedGraph`（压缩图 + 还原）+ `compressEdgeWeight`（逐原边权重累计）。
- `compression.test.ts`：10 项单元测试。
- 本说明（原理 + 口径 + 实测数据）。

不新增 shared 契约、不新增数据库/持久化表、不改 A/C/D/E 目录；压缩函数为**纯函数**，禁转编辑后的失效重建由 A 按 `(mode, 禁转版本号)` 缓存，本模块不缓存。

## 2. 判定口径（issue #63 §3.2，已冻结）

### 2.1 度-2 判定

用**去重后的邻居数**：`N(v) = { w | 存在边 v→w 或 w→v }`，`|N(v)| == 2` 才是可压缩中间点。双向道路普通中间点有向度 = 4（入 2 出 2）但邻居数 = 2，故**不直接使用有向度**。

### 2.2 保留集（命中即不压缩）

| # | 类别 | 判定来源 |
|---|---|---|
| 1 | 禁转 via 节点 | 调用方传 `protectedNodes`（C 的 `collectCompressionProtectedNodes` 合并 `turnViaNodeIds`） |
| 2 | 换乘连接涉及的路网节点 | 调用方传 `protectedNodes`（`transferNodeIds`，A 按模态筛选后喂入） |
| 3 | 属性变化点（等级/限速/oneway/权限） | `wayBoundary.hasBoundary(inWay, outWay)` 为真 |
| 4 | 方向模式变化点 | B 自判：节点的入/出方向不是「干净直通」 |
| 5 | 链端点（含模态准入边界） | 去重邻居数 ≠ 2 天然不满足度-2 |

「干净直通」仅两种：**单向直通**（恰一入一入，且入 ≠ 出）或**双向直通**（入 = 出 = {两邻居}）。分叉/汇合/死端（如两条一向路都指向同一终点）一律保留。

## 3. 压缩算法

1. 建**有向入/出邻接** + **去重邻居表**（一遍扫描）。
2. 逐节点判可压缩：邻居数 == 2 ∧ 非保留 ∧ 非属性边界 ∧ 干净直通。
3. **断开纯环**：可压缩节点诱导图中「所有节点诱导度 == 2」的连通分量整体保留（避免自环捷径）。
4. **链式收缩**：从每个保留节点的每条出边出发，沿可压缩节点「直通」到下一个保留节点，串成一条压缩边。直通后继 = 「`to ≠ 来路` 的那条出边」（干净直通节点恰有一条）。

压缩边记录 `originalEdgeIds`（原图有向边序列，`from → to`）、起止原图节点、`distance`（Σ 原边 Haversine）。未压缩的原边保留原边 id，`originalEdgeIds = [自身]`；跨链压缩边用大于所有原边 id 的新 id——两者统一经 `expandEdgeIds` 展开，无需区分「是否被压缩」。

## 4. 双向映射与还原

- `CompressedGraph` 满足 `ReadonlyAdjacency`，可直接供 `dijkstraWithTurnRestrictions` / `multimodalDijkstra` 使用。
- `expandEdgeIds(compressedEdgeIds)`：按序展开拼接各压缩边的 `originalEdgeIds`。
- `expandPath(compressedNodeIds, compressedEdgeIds)`：展开边序列后由原边端点重建节点序列（首边起点 + 各边末端），保证与原图**逐边一致**，共享的原图节点自然只出现一次。

## 5. 权重累计口径

- 距离口径：`CompressedEdge.distance` = Σ 原边 Haversine（构造时预计算，O(1)）。
- 时间口径：`compressEdgeWeight(graph, originalWeight)` 对压缩边**逐原边求权再求和**，不先平均速度再乘总长（避免属性差异被摊平）。D 的每原边时间权重直接喂入即可。

## 6. 禁转编辑后的更新（A 落地，B 只提供纯函数）

`compressTopology` 不缓存、不持久化。禁转增删改 → `getCompressionState().version` +1 → A 的缓存按 `(mode, 版本号)` 失效 → 下次取压缩图重建。缓存须绑定运行时实例（不同实例版本都从 0 开始）。

## 7. 武汉实测（car 模态，真实派生数据）

环境：Node 22.23.5，`npm run prepare:data` 产出的 `data/derived/wuhan-roads.json`（69,382 ways / 627,900 nodes / 673,120 segments）。压缩输入含 52 个 OSM 禁转 via 节点（`importOsmRestrictions` + `collectCompressionProtectedNodes`），单模态无换乘端点。

| 指标 | 压缩前 | 压缩后 | 压缩比 |
|---|---|---|---|
| 节点数 | 532,029 | 78,780 | **85.2%** |
| 有向边数 | 986,418 | 187,570 | **81.0%** |
| 被压缩节点 | — | 453,249 | — |

- 压缩耗时：约 7.3 s（含建邻接 + 判可压缩 + 链式收缩）。
- 查询耗时（公平口径：原图用 `Graph.edgeLength` 预计算、压缩图用 `distance` 预计算，均为 O(1) 边权；20 组随机**保留节点**点对）：原图 1,289 ms/查询，压缩图 206 ms/查询，**提速 6.25×**（与节点+边规模比 5.7× 基本一致）。

> 说明：真实运行时原图走 `createAdjacencyView` + 逐边 Haversine，压缩图走预计算 `distance`，实际提速会更高；此处用「两边都预计算」隔离出纯图规模收益，便于与 C 的拓扑口径对齐。

## 8. 与 A 的接口对齐（待 A 接线）

- B 提供 `compressTopology` + `CompressedGraph`（含 `stats` / `expandEdgeIds` / `expandPath`）+ `compressEdgeWeight`。
- A 在 `shared/` 冻结压缩结果类型（压缩边含 `originalEdgeIds`、压缩统计）后适配；B 不碰 shared。
- **已知集成点**：压缩图只含保留节点。A 的 `/api/path` 坐标吸附命中的节点若被压缩掉，须先落到邻近保留节点（或保留全部「可吸附」节点），否则 `hasNode` 早退。禁转 via 节点均在保留集内，禁转判定不受影响，但**压缩边端点落在 via 节点时**，其 `fromEdge`/`toEdge` 是压缩边 id、非原图边 id，A 需用 `originalEdgeIds` 首/尾原边 id 查禁转表。

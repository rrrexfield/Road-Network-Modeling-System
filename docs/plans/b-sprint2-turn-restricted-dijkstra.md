# B 第二次作业任务准备（转向限制搜索）

日期：2026-11-05。状态：`server/src/graph/` 新增带禁转的 Dijkstra，实现立项文档 §3.3.2 的边扩展状态空间；6 项测试通过，全仓 234 项测试 + server typecheck + 全仓 lint 全绿。**尚未由 A 接入 `/api/path`**，禁转尚未端到端影响 REST 路径结果。

## 1. 范围

对应 issue #28 与 Backlog GE-5，全部落在 B 唯一修改权目录 `server/src/graph/`。A*（GE-4）按 issue #28 约定属作业四，本次只预留接口、不实现。

| 交付 | 内容 | 文件 |
|---|---|---|
| 禁转判定形态 | `TurnRestrictionPredicate = (via, from, to) => boolean` | `turn-restricted-dijkstra.ts` |
| 边扩展 Dijkstra | `dijkstraWithTurnRestrictions(graph, source, target, isTurnForbidden?, weight?)` | 同上 |
| Graph 边访问器 | `Graph.edge(id)`：按边 id O(1) 取边 | `graph.ts` |

## 2. 为什么必须是 `(node, inEdge)` 状态空间

转向限制约束的不是节点，而是 (入边, 出边) 对。纯节点图状态只有“我在 node”，丢失来路，支配性剪枝出错：到达同一路口有两条路径（经西边代价 5、经南边代价 8），节点图保留 5、剪掉 8，但“经西边左转”被禁，真正可行的是被剪掉的“经南边直行”。错误不在算法，在状态定义缺失入边维度。

实现把状态展开为“以哪条入边到达当前节点”：入边 `e` 唯一确定节点 `e.to`，故 `(node, inEdge)` 用入边 id 编码，等价且更紧凑。松弛出边前查一次禁转表：

```ts
for (const out of graph.outEdges(viaNode))
  if (!isTurnForbidden(viaNode, inEdge, out.id)) relax(out);
```

不预建 O(E) 规模的展开图——编辑器改限制即改表项、立即生效，是物化 EEG 的等价替代。

## 3. 接口与对接

- **独立入口**：不改变现有 `dijkstra` 的签名与行为（既有测试零回归）；未提供谓词时等价于“全部允许”，距离与 `dijkstra` 一致（平局时边序列可能与节点版不同，调用方不得依赖平局边序列）。
- **谓词形态**：`(via, from, to) => boolean`，与 C 的 `TurnRestrictionTable.isForbidden`、A 的 `PersistentTurnService.isForbidden` 签名一致；graph 只依赖此只读函数，不依赖 topology/io 具体类型。
- **A* 预留**：作业四 A* 复用同一 `TurnRestrictionPredicate`，在优先队列 key 上叠加 haversine 启发式即可，签名无需改动。

## 4. 测试覆盖（答辩素材）

| 用例 | 证明点 |
|---|---|
| 空限制与普通 dijkstra 一致 | 兼容“无限制”模式，无回归 |
| 禁左转后该转向不可用、同路口直行/右转不受影响 | 限制只作用于目标边对 |
| 同一路口、不同入边的禁转互不影响 | 节点级标签做不到，是 `(node, inEdge)` 的核心 |
| 禁转使路径改道且代价变长 | “限制正确影响路径” |
| 缺节点/同点/不可达约定 | `distance = Infinity` + 空序列 |
| 武汉五路口固定夹具 | 禁左转后绕行、中心节点访问两次，证明未错误剪枝 |

五路口固定夹具 `server/src/io/fixtures/wuhan-five-arm.json`（节点 1881981626，武汉一元路/胜利街）由 C 提供、B/E 共用，见 `docs/plans/c-wuhan-five-arm-fixture.md`。B 侧测试 `wuhan-five-arm.test.ts` 验证搜索绕行；人工禁左仅为演示，不声称现实道路或 OSM 数据禁止左转。

## 5. 待办 / 依赖

- **A 接入 `/api/path`**：REST 层需把 `PersistentTurnService.isForbidden` 注入 `dijkstraWithTurnRestrictions`（并与编辑器共用同一份禁转服务），禁转才端到端影响路径结果。已提 issue 交 A。
- **跨模态路径**（issue #34 的 B 部分）依赖 C 的“转换点吸附规则”（尚未完成），本次不实现。
- 五路口固定用例仍待人工地图核对（C 记录），答辩前需确认选址。

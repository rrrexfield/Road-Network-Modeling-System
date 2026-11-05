# 作业二 REST 接入说明（A → B / C / D / E）

日期：2026-11-04。状态：A 已把 C 的 Sprint 2 模块挂到 REST 层并完成真实数据联调，对应 issue #33。B（#28）、E（#29）可直接开工，不再需要向 A 索取数据。

## 一、已就位的四个接口

契约类型全部冻结在 `@gisalgo/shared`（issue #24 / PR #25），前端与服务端禁止另定义副本。

| 方法 | 路径                                             | 响应                                             |
| ---- | ------------------------------------------------ | ------------------------------------------------ |
| GET  | `/api/network?mode=car\|walk\|bike\|bus`         | `RoadFeatureCollection`（结构同 `/api/network`） |
| GET  | `/api/transfer-points?mode=car\|walk\|bike\|bus` | `TransferPoint[]`                                |
| GET  | `/api/intersections/:nodeId/turns?mode=`         | `IntersectionTurns`                              |
| PUT  | `/api/intersections/:nodeId/turns?mode=`         | `SetIntersectionTurnsResponse`                   |

`mode` 缺省为 `car`；非法 `mode` 返回 400。

### `/api/network?mode=`

- **不带 `mode` 时行为与作业一完全一致**（返回全量原始路网 GeoJSON，31 MB），作业一的联调与演示不受影响。
- 带 `mode` 时只返回该模态**准入通过且真正产生有向边**的道路。方向未支持的道路虽通过准入但不产生边，不渲染（渲染出来会误导为可通行）。
- 实测（武汉全量）：car 25.7 MB / 55,156 条要素；walk 27.5 MB / 61,777 条；bike 24.1 MB；无 mode 31 MB。

### `/api/transfer-points?mode=`

- 实测：car 928 个、walk 2,596 个、bus 1,231 个、bike 112 个。与 C 在设计文档中记录的数值一致。
- 语义仍是**站点标记筛选**，不代表已验证的换乘连接或出入口可达性（见 issue #34）。

### `/api/intersections/:nodeId/turns`

- `nodeId` 是 OSM 节点 ID（安全整数），`position` 为 `[lon, lat]`。
- `turns` 是该路口**全部**转向动作（入边 × 出边，含掉头），每项含 `fromEdge`、`toEdge`、`fromWayId`、`toWayId`、`turnKind`、`angleDelta`、`forbidden`、`fromOsm`。
- `turnKind` / `angleDelta` **仅供展示**；模糊路口回退显示「驶入<道路名>（左偏 75°）」。
- 实测：五路口候选节点 `1881981626`（一元路/胜利街）返回 12 个转向，与 C 记录的「真实单行规则下 12 个转向」一致。

### `PUT /api/intersections/:nodeId/turns`

- body：`{ "forbidden": [{ "fromEdge": 1, "toEdge": 2 }] }`，语义是**整体覆盖**该路口的禁转集合（编辑器是「完整转向清单 + 勾选」）。
- 写盘优先：先事务写 SQLite，再改内存；写盘失败时旧内存规则不变。
- 覆盖后重启服务端，规则能从 `data/derived/wuhan-turns.sqlite` 恢复（按 way 段端点 + 几何重新匹配，不存易变的 edgeId）。

## 二、错误映射（A 已实现，不留裸 500）

| 状态码 | 触发条件                                                         | 响应                                                                                    |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 400    | `mode` 非法；`nodeId` 非整数；请求体结构不合法；边对不属于该路口 | `{ error: { message } }`                                                                |
| 404    | 路口不存在或坐标非法                                             | `{ error: { message } }`                                                                |
| 409    | 禁转快照恢复存在失配（数据已变，禁止覆盖旧快照）                 | `{ error: { message, restoreIssues } }`，`restoreIssues` 逐条给出 `ordinal` 与 `reason` |
| 422    | 转向几何无法判定，无法列出该路口的转向动作                       | `{ error: { message } }`                                                                |
| 503    | 派生文件缺 Sprint2 字段（未重跑 `npm run prepare:data`）         | `{ error: { message } }`，其余接口不受影响                                              |
| 500    | 其他内部错误                                                     | `{ error: { message: '服务器内部错误' } }`，详情进服务端日志                            |

服务端已统一错误形状为 `{ "error": { "message": "..." } }`，未知路由返回 404 同形状（此前是 Fastify 默认形状）。

> 实现说明：C 的模块目前抛普通 `Error`（带中文消息），A 不改 C 的目录，因此在 `server/src/api/modal-routes.ts` 的 `mapTurnError` 里按消息前缀归类。若 C 后续改为抛带 `code` 的错误，只需替换这一个函数的实现，路由行为不变。

## 三、前端封装（E 直接用）

`web/src/api-client.ts`（A 维护）已补齐：

```ts
fetchNetworkByMode(mode: TravelMode): Promise<RoadFeatureCollection>
fetchTransferPoints(mode: TravelMode): Promise<TransferPoint[]>
fetchIntersectionTurns(nodeId: number, mode?: TravelMode): Promise<IntersectionTurns>
setIntersectionTurns(nodeId, forbidden: { fromEdge, toEdge }[], mode?: TravelMode): Promise<SetTurnsResult>
```

`SetTurnsResult` 把「恢复失配」与「一般失败」分开：

```ts
type SetTurnsResult =
  | { ok: true; restrictionCount: number }
  | {
      ok: false;
      reason: 'restore-mismatch' | 'error';
      message: string;
      restoreIssues?: RestoreIssue[];
    };
```

`reason === 'restore-mismatch'` 时应提示用户先处理数据变化（禁转快照与当前路网不匹配），而不是重试。

## 四、B 的集成点（issue #28）

B 的图引擎必须与 REST 层**共用同一份禁转服务**：编辑器保存的禁转要立即改变路径结果，若各自持有实例则内存态会分叉（磁盘一致、内存不一致）。

A 已在 `server/src/api/index.ts` 暴露运行时注册表（B 经该公开入口消费，符合「跨目录只引 index.ts」的约定）：

```ts
import { getActiveModalRuntimeRegistry } from '../api/index.js';

const registry = getActiveModalRuntimeRegistry(); // 进程内唯一实例
const runtime = registry.runtime('car'); // 该模态的拓扑 + 禁转服务
runtime.service.isForbidden(viaNode, fromEdge, toEdge); // 只读判定函数
runtime.topology; // 该模态的 TopologyResult
```

- `registry.runtime(mode)` 按需构建该模态（武汉全量约 5 秒、约 1 GB 堆），并按 LRU 保留；B 在 `server/src/graph/` 内建 Graph 时直接消费 `runtime.topology`（`new Graph(topology.nodes, topology.edges)`），不必自己再构图。
- **A 的运行时不含 Graph**：转向接口只依赖禁转服务，Graph 由 B 在需要搜索的模态上构建，避免为纯展示/编辑付出 2.9 秒与约 460 MB 的常驻代价。
- 依赖方向为 `graph → api`（B 引 A 的公开入口）。该方向按 CODEOWNERS 需要 A 批准，**A 已预批**：A 的运行时是唯一实例的持有方，这是避免禁转状态分叉的必要条件。若更希望 B 定义注入点（`setTurnChecker`）由 A 在 `server/src/index.ts` 调用，请在本 issue 下回复，A 改接线方式。
- 禁转判定函数签名建议沿用 issue #28 的设想：`(viaNode, fromEdge, toEdge) => boolean`；`viaNode` 即搜索状态中的当前节点。

## 五、E 的集成点（issue #29）

- 多模态切换：`fetchNetworkByMode(mode)` 拿到该模态要素后重建 deck.gl 图层；`fetchTransferPoints(mode)` 打点显示。
- 转向限制编辑器：点路口 → `fetchIntersectionTurns(nodeId, mode)` 列出全部转向 → 勾选后 `setIntersectionTurns(nodeId, forbidden, mode)` 覆盖保存 → 地图上把被禁转向画成红色弧线（AGENTS.md 的异常红 `#e88`）。
- **读写必须带同一个 `mode`**：边 ID 按构边顺序生成，只在所属模态内有效；`car` 与 `walk` 下同一路口的 `fromEdge`/`toEdge` 不通用，模态不一致时服务端返回 400（明确报错，不会静默写错规则）。
- 切换模态后首次请求转向接口会变慢（约 5 秒，该模态运行时需重建），建议在 UI 上给出「首次加载」提示。

## 六、其余角色

- **C**：C 的模块已全部接上，`server/src/io/index.ts` 与 `server/src/topology/index.ts` 的公开入口未被改动。派生数据已按新格式重建（`nodeTags` 6,995 条 / `relations` 353 条 / `transferPoints` 2,596 个），旧派生文件会触发 503 降级而不是报错。
- **D**（issue #23）：`AttributeCompleteness` / `AttributeCompletenessReport` 契约已冻结（`NetworkStats.attributeCompleteness` 为**可选**字段，缺省表示服务端尚未提供，不得以 0 冒充完整率）。D 可直接在 `server/src/weights/` 实现，统计口径为**按 way 统计**（属性来自 way 标签，不是逐条有向边，否则同一 way 的标签会被拆边重复稀释）。A 在 D 交付后把该字段收紧为必填。

## 七、验证记录

- `npm run typecheck` / `npm run lint` / `npm test` 全绿，全仓 228 项测试通过（新增 16 项覆盖模态过滤、转向读写、错误映射与 LRU 缓存）。
- 真实数据冒烟（武汉全量，服务端 + curl）：
  - `/api/transfer-points?mode=car` → 928 个；`?mode=walk` → 2,596 个；
  - `/api/network?mode=car|walk|bike` → HTTP 200，25.7 / 27.5 / 24.1 MB；不带 mode → HTTP 200，31 MB；
  - `/api/intersections/1881981626/turns?mode=car` → HTTP 200，12 个转向；
  - `PUT` 一条禁转 → `{"ok":true,"restrictionCount":1}`，随后 GET 该转向 `forbidden: true`，重启服务端后仍然为 `true`；
  - 非法边对 → 400；非法请求体 → 400；非法 nodeId → 400；不存在的路口 → 404；非法 mode → 400；未知路由 → 404。

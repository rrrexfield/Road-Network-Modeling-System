# GISAlgo · 路网建模与拓扑构建系统(G2 组)

2026-11-06 `fix/node-access` 分支提供C节点准入修复（待评审）：`buildModalTopology(nodes,ways,mode,nodeTags?)` 返回 `nodeAccess` 诊断，C的 `createTurnRuntime` 已接入。A的网页模式运行时仍需传节点标签才能生效；未传时兼容旧图且标记未检查。规则、399项验证及保守排除局限见 `docs/plans/c-node-access-ready.md`。

面向 GIS 算法课程的 B/S 架构路网建模系统:Node.js 服务端持有路网图模型与全部算法,浏览器端负责可视化与交互编辑。

2026-11-05 C分支已同步A的REST与PathSegment冻结契约，另提供 `buildTransferAttachments`（逐模式节点/入出方向/核验诊断）与 `computeTransferPenalty`（显式参数计算秒数）。B调用示例见 `docs/plans/c-b-attachments-ready.md`；未经核验的候选不可用于实际连接，武汉停车楼入口仍待核验。本分支尚待PR评审。

当前 `feature/transfer-attachments` 分支另提供 `matchTransferConnections`（逐模式节点证据/距离/诊断）与 `inspectTransferEntrances`（原way入口候选），并补识别地铁出入口；武汉标记增至2930，旧派生文件需重建。本批尚未合并或生成实际转换边；提供真实片段的分段可达性测试，停车入口仍需核验，多段路径契约与搜索待A/B/E对接。调用、实测和限制见 `docs/plans/c-transfer-connections.md`。

本仓库已提供可交接的 SQLite 运行时：`server/src/io/index.ts` 导出 `createTurnRuntime` / `PersistentTurnService`，从新版派生文件完成模式构图、OSM禁转导入和数据库恢复，并提供磁盘优先的 `setTurns`。数据修复、武汉实测和调用示例见 `docs/plans/c-sqlite-ready.md`。禁转快照落 `data/derived/wuhan-turns.sqlite`，写盘失败不改旧内存，重启按 way 段端点+几何重新匹配恢复。

C 的 Sprint 2 基础模块已合入 main：禁转表、路口转向枚举、SQLite 手动禁转快照、四模态构图、原始数据转换点提取，以及逐模式接驳表与换乘罚时计算。公开入口为 `server/src/topology/index.ts`、`server/src/io/index.js`。这些能力已接入 REST 层（见下方作业二说明）；**真实换乘连接与跨模态搜索尚未完成**，使用与限制见 `docs/plans/c-sprint2-handoff.md`、`docs/多模态路网设计.md`。

当前进度:**Sprint 1(路网拓扑构建基础)已完成并合入 main**——图引擎、拓扑构边、权重统计、属性面板与起终点选路均已交付,M1 交付物 `docs/拓扑验证报告.md` 已提交。**作业二(转向限制与多模态路网)的接口契约已冻结**,功能实现按目录所有权分派给 B/C/E,详见对应交接 issue。

**作业二的四个 REST 接口已由 A 挂载上线**(issue #33):`GET /api/network?mode=`、`GET /api/transfer-points?mode=`、`GET/PUT /api/intersections/:nodeId/turns`。派生数据已按新格式重建(保留 POI 与 relations),禁转快照落 `data/derived/wuhan-turns.sqlite`。B 的禁转感知搜索(#28)与 E 的编辑器/模态切换(#29)可直接消费,交接说明见 `docs/plans/a-sprint2-rest-handoff.md`。

**作业二的转向限制已端到端打通**(issue #38,PR #39/#40/#42 已合入 main):B 的 `(node, inEdge)` 边扩展 Dijkstra 使禁转真正影响路径,`/api/path` 新增 `mode` 参数——缺省走基础图不施加禁转(与作业一一致),显式给模态时走该模态子图并施加该模态的禁转;编辑器保存禁转后路径立即绕行(实测武汉五路口 500.18 m/7 节点 → 751.07 m/23 节点,清空后恢复一致),编辑器与路径计算共用同一份禁转服务、无内存分叉。另新增 `GET /api/intersections/nearest` 把点击坐标反查为可编辑路口(#43),路口判定在服务端完成:当前模态内邻接节点数 ≥ 3、按球面距离、超阈值返回 404。派生数据已重建为 2930 个转换点(subway 659 / bus 1231 / parking 1040)。

**作业二的权重与统计已补齐**(issue #23/#47,PR #48/#49):`/api/path` 的模态分支按模态速度表计算时间(步行 4 km/h,不再是汽车 fallback 30 km/h),`/api/stats` 传入全量 way 标签表启用**属性完整率**(按 way 统计、只计原始标注);`NetworkStats.attributeCompleteness` 已由可选收紧为**必填**。权重配置面板已接回主界面(#45):它只管全局权重参数(速度系数、等级限速覆盖),优化目标(最快时间/最短距离)留在起终点选路卡,避免两个入口改同一个值;面板改动后统计与路径按新配置重算。

**跨模态路径已打通**(issue #34):`GET /api/path` 新增 `modes=car,walk` 形式的**有序模态序列**,服务端在模态子图之间按转换点换乘,按冻结契约 `PathResult.segments` 分段返回(段间以 `TransferPoint.id` 相接),换乘罚时(等待 + 接驳)单独下发、不计入距离。武汉实测:2930 个转换点可建立 **2447 条换乘连接**(452 条为设施自身节点即该模态节点的精确连接,1995 条为半径内近邻近似),模态对覆盖 bus↔walk 1103/1092、car↔walk 90/88、bike↔walk 37/37;真实场景已跑通「驾车 5.5 km → 停车场换乘 → 步行 774 m 到江汉路」。实现口径、阈值、代价模型与已知边界见 `docs/多模态路网设计.md`「跨模态路径的实现口径」一节。

**作业二最终验收清单与演示脚本**见 `docs/作业二验收清单.md`:逐条对照任务书 G2 第 2 次作业的任务内容、产出物与评分维度,附答辩演示分步脚本(转向限制改路径 → 多模态切换 → 跨模态路径 → 权重与统计)、提交材料清单与已知边界的如实口径。

Sprint 1 的 B 图引擎、C 拓扑与 D 权重统计已接入服务启动链路:`server/src/index.ts` 依次执行 `loadNetwork → buildTopology → new Graph → computeTopologyStats`,再注册 REST/WS 与权重统计路由;`/api/health` 与 WS 的 `edgeCount` 为**有向边数**。topology 不做模态/车辆准入过滤,不能将输出解释为汽车可通行图;无法确定方向的道路跳过并在启动日志中列明。B 模块规则见 `docs/plans/b-sprint1-graph.md` 与 `docs/plans/b-sprint1-graph-interface.md`,C 模块见 `docs/plans/c-sprint1-topology.md`。

D 的 `server/src/weights/` 提供 Haversine 距离、等级限速、可注入 `dijkstra` 的边权函数与网络统计;`web/src/charts/`、`web/src/panels/stats/`、`web/src/panels/weight/` 提供 ECharts 深色主题、统计仪表盘与权重配置面板,独立预览页见 `web/src/panels/stats/demo.html`。统计中的拓扑指标由 B 的 `computeTopologyStats` 填充(`topologySource='graph-engine'`),`/api/stats` 按权重配置缓存并预热默认配置;`WeightProfile`/`NetworkStats` 等契约已冻结进 `shared/src/index.ts`。主界面右侧栏挂载统计与权重面板(权重面板只管全局权重参数,优化目标留在起终点选路卡),权重变化后统计与路径按新配置重取、重算。全仓 371 项测试通过。

前端交互(E):`web/src/map/path-selection.ts` 提供起终点选路(点击地图取点 → 服务端吸附到最近节点 → 高亮路径,切换权重目标后自动重算);`web/src/panels/property/` 为道路属性面板组件(视图模型与 DOM 解耦,可在 Node 环境单测)。`/api/path` 的服务端坐标吸附由 issue #18 采纳**方案 A**:62.8 万节点不必下发浏览器,前端只传点击位置。

## 技术栈

| 层 | 选型 |
|---|---|
| 服务端 | Node.js 22 LTS · TypeScript · Fastify 5 · WebSocket(@fastify/websocket) |
| 前端 | Vite · TypeScript · MapLibre GL JS · deck.gl(PathLayer) · ECharts |
| 契约 | npm workspaces monorepo,跨端类型统一定义于 `shared/src/index.ts` |
| 质量 | Vitest · ESLint · Prettier |

## 目录结构

```
GISAlgo/
├── server/              # Fastify 服务
│   └── src/
│       ├── api/         # REST + WS 路由;index.ts 为跨目录公开入口(多模态运行时)
│       ├── io/          # 派生数据装载(内存 nodes/ways/GeoJSON)、禁转持久化
│       ├── topology/    # [C] 道路方向与构边(启动时接入)
│       ├── graph/       # [B] 图引擎:Graph/Dijkstra/拓扑统计(启动时接入)
│       ├── weights/     # [D] 权重与统计 + REST 路由(已注册)
│       └── index.ts     # 组装与启动(端口 3000)
├── web/                 # Vite 前端(端口 5173,代理 /api、/ws 到 3000)
│   └── src/
│       ├── main.ts             # 地图、图层与面板装配
│       ├── api-client.ts       # REST+WS 客户端(含模态路网/转换点/转向限制封装)
│       ├── map/                # [E] 底图检测/降级、路网图层工厂、起终点选路
│       ├── charts/             # [D] ECharts 按需装配、深色主题、图表工厂
│       └── panels/
│           ├── stats/          # [D] 统计仪表盘 + 独立预览页 demo.html
│           ├── weight/         # [D] 权重配置面板
│           └── property/       # [E] 道路属性面板
├── shared/              # 跨端契约:领域模型 / API 出入参 / WS 消息 / 路网配色
├── scripts/             # prepare-data.ts 数据预处理 · dev.mjs 启动编排
├── .github/             # CODEOWNERS 目录所有权 · CI 工作流 · PR 模板
├── data/                # 原始数据(大文件入库由教师渠道分发);data/derived/ 为生成物,不入库
└── docs/                # 立项文档、CHANGELOG、AI 日志、参考资料(docs/ref/)
```

## 快速开始

环境要求:Node.js ≥ 22.13(22.13.0 起 `node:sqlite` 不再需要 `--experimental-sqlite` 标志;开发机验证于 22.23.4),npm 10+。

```bash
npm install
npm run dev
```

`npm run dev` 会依次完成:

1. 检测 `data/derived/wuhan-roads.json`,缺失时自动执行数据预处理(数秒,从 `data/wuhan.json` 过滤路网);
2. 启动服务端(127.0.0.1:3000),将路网载入内存;
3. 启动前端(http://localhost:5173)并自动打开浏览器。

打开后应看到:深色底图上的武汉路网(按 highway 等级着色);点击道路弹出属性;左下角为 API / WS / 底图状态徽标;右侧为统计仪表盘与权重配置面板(实时数据,拓扑指标来自图引擎);悬停可点选道路时光标变为 pointer。

> 离线环境:底图(OpenFreeMap Dark,免 key)加载失败会自动降级为纯色背景,路网渲染与点选不受影响。

## 数据管线

```
data/wuhan.json (教师备份,162MB,不入库——经教师/组内渠道获取后置于 data/)
   │  npm run prepare:data
   ▼
data/derived/wuhan-roads.json (~30MB, 不入库)
   │  server/src/io/loader.ts 启动时载入
   ▼
内存路网:627,898 节点 / 1,194,218 条有向边 / 69,382 条道路
```

- 源数据 `data/wuhan.json` 与 `data/hubei.json` 已从 Git 历史彻底移除,不随仓库分发;克隆后需自行获取 `wuhan.json` 放入 `data/`,否则预处理无法执行(可直接向组内索取现成的 `data/derived/wuhan-roads.json` 放到同路径使用);
- 预处理只保留带 `highway` 标签的 way 及其关联节点,保留 OSM 节点 ID(`nds`),供 Sprint 1 图引擎构建拓扑;
- `NetworkMeta.segmentCount` 是方向处理前的原始相邻节点段数;服务端 `/api/health` 与 WS 的 `edgeCount` 是方向化后的有向边数(双向道路计两条),统计接口使用同一有向边集;
- 处理脚本读取 162MB JSON 需要较大堆内存,已通过 `NODE_OPTIONS=--max-old-space-size` 注入,无需手动设置。

## 可用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 一键启动(自动补数据 + 服务端 + 前端) |
| `npm run prepare:data` | 单独执行数据预处理 |
| `npm test` | Vitest 单元测试 |
| `npm run typecheck` | shared / server / web 三包 TypeScript 检查 |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build` | 前端产物构建(`web/dist`) |

## 服务端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查:节点 / 有向边 / way 计数与运行时长 |
| GET | `/api/network` | 全量路网 GeoJSON(每 way 一条 LineString,属性含 id/name/highway/tags) |
| GET | `/api/network?mode=car\|walk\|bike\|bus` | 指定模态的路网 GeoJSON:只含该模态准入且真正产生有向边的道路;不带 `mode` 时行为不变 |
| GET | `/api/transfer-points?mode=car\|walk\|bike\|bus` | 模态转换点(`TransferPoint[]`,位置为 `[lon, lat]`),按模态筛选站点类型 |
| GET | `/api/intersections/nearest?lon=&lat=&mode=&maxDistanceM=` | 点击坐标反查**可编辑路口**(`NearestIntersectionResponse`):只在当前模态中判定、邻接节点数 ≥ 3(排除道路折点与中间节点)、按球面距离计算;超出阈值返回 404,不返回"最近但很远"的节点 |
| GET | `/api/intersections/:nodeId/turns?mode=` | 某路口的全部转向动作(`IntersectionTurns`):`turnKind`/`angleDelta` 仅供展示,`forbidden` 为当前禁转状态,`fromOsm` 区分 OSM 导入与手动设置;`mode` 缺省 `car` |
| PUT | `/api/intersections/:nodeId/turns?mode=` | **整体覆盖**该路口禁转集合,body `{ forbidden: [{ fromEdge, toEdge }] }`,返回 `{ ok, restrictionCount }`;写盘优先,写盘失败时旧规则不变 |
| GET | `/api/path` | 起终点选路:`from=lon,lat&to=lon,lat&metric=distance\|time`,服务端吸附到最近节点后跑 Dijkstra,返回 `PathResult` + 吸附坐标 + 路径折线;不可达返回 404。支持 `speedFactor`、`speedKmh=等级:限速,…`(与 `/api/stats` 同口径) |
| GET | `/api/path?mode=car\|walk\|bike\|bus` | 同上,但走**该模态子图**并施加该模态的禁转(编辑器保存的禁转会立即改变路径);时间口径按该模态速度表换算;**不带 `mode` 时走基础图、不施加禁转**,与作业一行为一致 |
| GET | `/api/path?modes=car,walk` | **跨模态路径**(issue #34):`modes` 是逗号分隔的**有序**模态序列(至少两个),服务端在模态子图之间按转换点换乘,返回 `segments` 分段明细(段间以 `TransferPoint.id` 相接);`transferPenaltySeconds` 单独给出换乘罚时(不计入 `distance`);与 `mode` 互斥,无可用换乘连接或不可达返回 404 |
| GET | `/api/weights/profile` | 权重基线:默认 `WeightProfile` + 各等级默认限速表 |
| GET | `/api/stats` | 网络统计:里程/等级分布/边长分布/通行时间/拓扑指标;支持 `metric`、`speedFactor`、`speedKmh=等级:限速,…`;结果按配置缓存 |
| WS | `/ws` | 消息信封 `{ type, payload }`;连接即推 `hello`(有向边数),支持 `ping`/`pong` |

错误响应统一为 `{ "error": { "message": "..." } }`;契约类型见 `shared/src/index.ts`,前后端禁止重复定义。

> **转向边的 ID 只在所属模态内有效**:边 ID 按构边顺序生成,不同模态的准入与方向规则不同,同一路口在 `car` 与 `walk` 下的 `fromEdge`/`toEdge` 不通用。编辑器读写必须带同一个 `mode`,否则服务端返回 400。

## 开发约定

- **协作规范(必读)**:根目录 `CLAUDE.md` 与 `AGENTS.md`(内容一致)——角色门禁、Git 分支/提交规范、API 与命名约定、前端样式基线;
- 里程碑与 Sprint 计划:`docs/立项文档.md`;变更记录:`docs/CHANGELOG.md`;AI 使用日志:`docs/AI日志.md`(课程硬性要求);
- 目录所有权:见立项文档 §4.1,跨目录只允许引用对方公开入口;`.github/CODEOWNERS` 把该表映射为 GitHub 强制审批——改动他人目录的 PR 需该 owner 批准;
- 提交门禁:`main` 受 ruleset 保护(禁止直推/强推,PR 需 1 个批准 + CI 通过),CI 跑 typecheck / ESLint / Vitest / 前端构建;
- 核心算法(图引擎 `server/src/graph/`)自 Sprint 1 起实现,Vitest 测试全绿是合入门槛。

## 已知注意点

- Node 22.11 搭配 Vite 6;maplibre-gl v6 需在 `vite.config.ts` 中排除依赖预构建(`optimizeDeps.exclude`),已配置;
- `node:sqlite`(禁转快照)在 22.13.0 起无需 `--experimental-sqlite` 标志,但仍会打印 `ExperimentalWarning`——这是上游 API 仍处实验阶段的事实,不做屏蔽;`engines` 已收紧为 `>=22.13.0`;
- 多模态按需构建:首次请求某模态时现建该模态子图与禁转表(武汉全量约 5 秒),因此切换模态后第一次请求会明显变慢,属预期行为;内存策略见 `docs/多模态路网设计.md`;
- **跨模态路径的内存代价**:一次跨模态查询要同时持有两个模态的图与禁转索引(武汉实测 car + walk 约 2.3 GB 堆),比单模态查询重得多;换乘连接表按模态集合缓存(全量四模态构建约 4 s),避免每次请求重算;
- Carto 瓦片自 2025 年起需要 API key(带水印),底图已改用 OpenFreeMap Dark;
- 端口占用:服务端 3000、前端 5173,启动前确保空闲。

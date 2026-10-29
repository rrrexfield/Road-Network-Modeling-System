# GISAlgo · 路网建模与拓扑构建系统(G2 组)

面向 GIS 算法课程的 B/S 架构路网建模系统:Node.js 服务端持有路网图模型与全部算法,浏览器端负责可视化与交互编辑。

当前进度:**Sprint 1(路网拓扑构建基础)已完成并合入 main**——图引擎、拓扑构边、权重统计、属性面板与起终点选路均已交付,M1 交付物 `docs/拓扑验证报告.md` 已提交。**作业二(转向限制与多模态路网)的接口契约已冻结**,功能实现按目录所有权分派给 B/C/E,详见对应交接 issue。

Sprint 1 的 B 图引擎、C 拓扑与 D 权重统计已接入服务启动链路:`server/src/index.ts` 依次执行 `loadNetwork → buildTopology → new Graph → computeTopologyStats`,再注册 REST/WS 与权重统计路由;`/api/health` 与 WS 的 `edgeCount` 为**有向边数**。topology 不做模态/车辆准入过滤,不能将输出解释为汽车可通行图;无法确定方向的道路跳过并在启动日志中列明。B 模块规则见 `docs/plans/b-sprint1-graph.md` 与 `docs/plans/b-sprint1-graph-interface.md`,C 模块见 `docs/plans/c-sprint1-topology.md`。

D 的 `server/src/weights/` 提供 Haversine 距离、等级限速、可注入 `dijkstra` 的边权函数与网络统计;`web/src/charts/`、`web/src/panels/stats/`、`web/src/panels/weight/` 提供 ECharts 深色主题、统计仪表盘与权重配置面板,独立预览页见 `web/src/panels/stats/demo.html`。统计中的拓扑指标由 B 的 `computeTopologyStats` 填充(`topologySource='graph-engine'`),`/api/stats` 按权重配置缓存并预热默认配置;`WeightProfile`/`NetworkStats` 等契约已冻结进 `shared/src/index.ts`。主界面右侧栏挂载统计与权重面板,权重变化后重取统计。全仓 141 项测试通过。

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
│       ├── api/         # REST + WS 路由
│       ├── io/          # 派生数据装载(内存 nodes/ways/GeoJSON)
│       ├── topology/    # [C] 道路方向与构边(启动时接入)
│       ├── graph/       # [B] 图引擎:Graph/Dijkstra/拓扑统计(启动时接入)
│       ├── weights/     # [D] 权重与统计 + REST 路由(已注册)
│       └── index.ts     # 组装与启动(端口 3000)
├── web/                 # Vite 前端(端口 5173,代理 /api、/ws 到 3000)
│   └── src/
│       ├── main.ts             # 地图、图层与面板装配
│       ├── api-client.ts       # REST+WS 客户端
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

环境要求:Node.js ≥ 22(开发机验证于 22.11),npm 10+。

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
| GET | `/api/path` | 起终点选路:`from=lon,lat&to=lon,lat&metric=distance\|time`,服务端吸附到最近节点后跑 Dijkstra,返回 `PathResult` + 吸附坐标 + 路径折线;不可达返回 404 |
| GET | `/api/weights/profile` | 权重基线:默认 `WeightProfile` + 各等级默认限速表 |
| GET | `/api/stats` | 网络统计:里程/等级分布/边长分布/通行时间/拓扑指标;支持 `metric`、`speedFactor`、`speedKmh=等级:限速,…`;结果按配置缓存 |
| WS | `/ws` | 消息信封 `{ type, payload }`;连接即推 `hello`(有向边数),支持 `ping`/`pong` |

错误响应统一为 `{ "error": { "message": "..." } }`;契约类型见 `shared/src/index.ts`,前后端禁止重复定义。

## 开发约定

- **协作规范(必读)**:根目录 `CLAUDE.md` 与 `AGENTS.md`(内容一致)——角色门禁、Git 分支/提交规范、API 与命名约定、前端样式基线;
- 里程碑与 Sprint 计划:`docs/立项文档.md`;变更记录:`docs/CHANGELOG.md`;AI 使用日志:`docs/AI日志.md`(课程硬性要求);
- 目录所有权:见立项文档 §4.1,跨目录只允许引用对方公开入口;`.github/CODEOWNERS` 把该表映射为 GitHub 强制审批——改动他人目录的 PR 需该 owner 批准;
- 提交门禁:`main` 受 ruleset 保护(禁止直推/强推,PR 需 1 个批准 + CI 通过),CI 跑 typecheck / ESLint / Vitest / 前端构建;
- 核心算法(图引擎 `server/src/graph/`)自 Sprint 1 起实现,Vitest 测试全绿是合入门槛。

## 已知注意点

- Node 22.11 搭配 Vite 6;maplibre-gl v6 需在 `vite.config.ts` 中排除依赖预构建(`optimizeDeps.exclude`),已配置;
- Carto 瓦片自 2025 年起需要 API key(带水印),底图已改用 OpenFreeMap Dark;
- 端口占用:服务端 3000、前端 5173,启动前确保空闲。

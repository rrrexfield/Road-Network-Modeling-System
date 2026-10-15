# 更新日志

格式参考 Keep a Changelog;版本对应课程里程碑。

## [Unreleased]

### Added(Sprint 1 · B 图引擎)

- 新增 `server/src/graph/` 模块（公开入口 `index.ts`）：有向图 `Graph`（邻接表 + Float32Array 紧凑坐标 + 增删边）、最小堆优先队列 `PriorityQueue`、Dijkstra 最短路径与路径重建、连通分量/度分布/悬挂节点统计。
- `Graph` 构造入参直接消费 C 的 `buildTopology()` 产物（nodes Map + edges RoadEdge[]），无需适配层；联调测试覆盖 oneway yes/-1/双向。
- Dijkstra 默认以端点 Haversine 距离为边权，预留权重函数注入（Sprint 3 接 D 的动态权重）。
- 新增 24 项图引擎单元/联调测试；`PathResult` / `TopologyStats` 暂定于 graph 内，待 A 冻结到 shared（issue #4、#5）。

### Added(Sprint 1 · C 数据与拓扑基础)

- 独立 `server/src/topology/` 模块：道路方向判定与按原始节点 ID 生成有向边，公开入口为 `index.ts`。
- 保留 bridge/tunnel/layer 等道路属性；几何交叉不新增连接，共享节点的匝道连接保持有效。
- 缺失或非法节点、重复道路 ID、退化段及未支持方向的诊断；缺失节点不跨缺口连线。
- 20 项方向测试、20 项构边测试、4 项报告测试，以及 C 任务准备与武汉全量检查记录。
- 可序列化构边报告：明确输入道路未做模态过滤，并列出无方向高速匝道、条件方向及未知方向的排除明细。
- 模块尚未接入现有 loader 或 B 的 Graph；M1 图范围、方向排除及路径/ID 约定的确认请求已整理为本地 Issue 草稿，待用户审核发布。

### Added(Sprint 0 · 立项与地基)

- npm workspaces monorepo:`server/`(Fastify)+ `web/`(Vite)+ `shared/`(跨端契约)+ `scripts/`
- 数据预处理脚本 `scripts/prepare-data.ts`:解析 `data/wuhan.json`,过滤 highway 路网与关联节点,生成紧凑派生数据 `data/derived/wuhan-roads.json`
- Fastify 服务:`GET /api/health`、`GET /api/network`(GeoJSON)、WebSocket `/ws`(hello/ping-pong)
- 前端:MapLibre Carto Dark 深色底图(离线自动降级纯色)+ deck.gl PathLayer 按等级着色渲染 + 点选道路弹出属性面板 + API/WS 状态徽标
- Vitest 解析器单元测试;ESLint + Prettier 基础配置
- 协作规范文档(`CLAUDE.md` / `AGENTS.md`,内容一致)与 AI 日志模板
- `npm run dev` 一键启动:自动补数据 → 服务端(3000)+ 前端(5173)

### Changed

- 根据 PR #3 评审兼容 oneway=true/false；补充全部有效中间节点保留及边 ID 仅在固定输入/规则下稳定的说明和测试。

- 契约更名:`NetworkMeta.edgeCount` → `segmentCount`,口径明确为预处理产物中的原始相邻节点段数(方向处理前);API/HealthResponse 的 `edgeCount` 含义不变,仍为服务端当前图的有向边数
- `data/wuhan.json`、`data/hubei.json` 自 Git 历史彻底移除,源数据不随仓库分发(经教师渠道获取);运行时数据由 `npm run prepare:data` 本地生成或直接使用组内分发的 `data/derived/wuhan-roads.json`

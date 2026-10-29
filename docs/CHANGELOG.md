# 更新日志

格式参考 Keep a Changelog;版本对应课程里程碑。

## [Unreleased]

### Added(Sprint 1 · A 集成)

- 契约冻结(issue #10):`WeightProfile`、`HighwayStat`、`LengthBucket`、`TopologyMetrics`、`TopologyMetricsSourceTag`、`NetworkStats`、`WeightProfileResponse` 进入 `shared/src/index.ts`;服务端 `weights` 改为从 shared 导入并只做 re-export,删除前端临时镜像 `web/src/charts/contract.ts`,前端统一经 `web/src/charts/index.ts` 引用同一份契约,前后端不再各自定义。
- 服务端启动组装(issue #9/#11/#12):`server/src/io/loader.ts` 暴露原始 `ways` 并移除预构无向边;启动时执行 `buildTopology → new Graph → computeTopologyStats`,再注册 `registerWeightRoutes`。`/api/health` 与 WS 的 `edgeCount` 改为有向边口径,`wayCount` 取保留道路数;`wayId → highway` 使用 C 确认的权威来源 `TopologyResult.ways`,统计边集为 `topology.edges`,启动日志输出拓扑 issue、方向排除数与缺失映射诊断。统计中的 `topology` 不再为占位,null 仅表示图引擎未接入。
- `/api/stats` 性能:`StatsInput` 新增可选 `edgeLength` 注入,服务端使用 `Graph.edgeLength`,使统计里程与路径权重同源;统计按归一化配置缓存(上限 32)并在插件注册时预热默认配置。
- 新增 3 项权重统计路由测试(普通端口 + fetch,规避 Node 22.11 下 light-my-request 的 ESM 兼容问题),覆盖权重基线、拓扑序列化、`speedFactor`/逐等级限速覆盖与缓存命中。
- 主界面接入 PR #15 的 `web/src/map/` 模块(底图可达性检测、离线降级样式、路网图层工厂),删除 `main.ts` 内的重复实现与 Carto 死代码。
- 统计/权重面板挂载到右侧 `#side-panels`(issue #13):路网加载成功后拉取 `/api/weights/profile` 与 `/api/stats`,权重配置变化去抖后重取统计;主界面不使用示例数据,接口不可用时显式标注。
- Vitest 放开 `web/**` 测试范围(issue #16),新增 `web/src/map/basemap.test.ts`。Vitest 4 已移除 `environmentMatchGlobs`,后续 DOM 测试使用文件头 `// @vitest-environment jsdom` 并在需要时补充 jsdom 依赖。
- 修复权重面板切换优化目标后右上徽标未同步的问题:徽标更新移入 `syncControls`,无需为刷新徽标而重建等级表格行。

### Added(Sprint 1 · A 契约与平台)

- 契约冻结:`PathResult`(Dijkstra 输出)与 `TopologyStats`(拓扑统计报告)进入 `shared/src/index.ts`(issue #4)。度均为有向度(入度+出度,M1 口径;无向物理邻接度取舍见 issue #5 留档,变更须契约评审);`degreeDistribution` 为进程内 Map,不可直接 JSON 下发;`PathResult.distance` 不可达为 Infinity,经 REST/WS 下发前由 API 层转换。
- `EdgeWeightFn` 暂不冻结:Sprint 3 权重注入前需 A/D/B 评审扩展(当前签名不含边长,无法实现行程时间权重)。

### Added(Sprint 1 · B 图引擎)

- 新增 `server/src/graph/` 模块（公开入口 `index.ts`）：有向图 `Graph`（邻接表 + Float32Array 紧凑坐标 + 增删边）、最小堆优先队列 `PriorityQueue`、Dijkstra 最短路径与路径重建、连通分量/度分布/悬挂节点统计。
- `Graph` 构造入参直接消费 C 的 `buildTopology()` 产物（nodes Map + edges RoadEdge[]），无需适配层；联调测试覆盖 oneway yes/-1/双向。
- Dijkstra 默认以端点 Haversine 距离为边权，预留权重函数注入（Sprint 3 接 D 的动态权重）。
- 新增 19 项图引擎单元/联调测试；`PathResult` / `TopologyStats` 已由 A 冻结到 shared（issue #4）。

### Added(Sprint 1 · D 权重与统计基础)

- 独立 `server/src/weights/` 模块:Haversine 距离、等级限速模型、可注入边权函数(距离/时间,经 `createEdgeWeight` 按 `WeightProfile.metric` 分派)与网络统计,公开入口为 `index.ts`。
- `WeightProfile` 纳入优化目标 `metric`(distance/time)、全局速度系数与逐等级限速覆盖表,`normalizeWeightProfile` 统一兜底外部输入。
- `GET /api/weights/profile`、`GET /api/stats`(支持 `metric`/`speedFactor`/`speedKmh` 查询参数)以 Fastify 插件形式提供,**尚未注册到服务端启动流程**,待 A 集成(issue 见 PR 描述)。
- 统计中的拓扑指标为显式占位:`topology=null` 且 `topologySource='pending'`,接入 B 的图引擎后经 `toTopologyMetrics()` 转为可序列化结构,不以零值冒充统计结果。
- `web/src/charts/`:ECharts 按需装配、`gisalgo-dark` 主题(配色取自 AGENTS.md 样式基线)、图表工厂(横向条形/环形/直方图)与数值格式化;`web/package.json` 新增 `echarts` 依赖。
- `web/src/panels/stats/` 统计仪表盘(KPI + 等级里程分布/占比/边长分布 + 拓扑指标区)与 `web/src/panels/weight/` 权重配置面板(优化目标、速度系数、等级限速表、通行时间预估),均为自包含组件,挂载待 E。
- 独立预览页 `web/src/panels/stats/demo.html`:优先请求实时接口,未就绪时降级到离线示例数据(由真实算法在合成路网上试算)并明确标注来源。
- 新增 55 项测试(geo 7、speed 8、weight 26、stats 14),全仓 124 项通过;设计说明见 `docs/plans/d-sprint01-weights-stats.md`。
- 适配 PR #14 契约冻结:删除本地 `TopologyMetricsSource` 镜像,改为从 `@gisalgo/shared` 引入 `TopologyStats`;`TopologyMetrics` 改为**派生**(`extends Omit<TopologyStats,'degreeDistribution'>`)而非平铺,避免字段漂移;`topologySource` 取值由模块路径 `'server/src/graph(graph-engine)'` 改为语义名 `'graph-engine'`。前端 `web/src/charts/contract.ts` 同样改为派生。
- 边长口径留档:统计当前用 `geo.ts` 的 `haversineMeters`(原始 float64 坐标),与 B 的 `Graph.edgeLength`(Float32 预计算)同源但数值不严格相等(单边最坏 ~0.7 m);待 A 组装出 Graph 后统计里程改取 `edgeLength`,切换前以 `docs/plans/d-sprint01-weights-stats.md` §4.2 为口径依据。
- `EdgeWeightFn` 沿用 B 的前置条件(返回 ≥0 且有限)并补测试锁定;图内注入路径成立(`Graph.addEdge` 已校验端点),`Infinity` 分支仅在图外场景触发。

### Added(Sprint 1 · C 数据与拓扑基础)

- 独立 `server/src/topology/` 模块：道路方向判定与按原始节点 ID 生成有向边，公开入口为 `index.ts`。
- 保留 bridge/tunnel/layer 等道路属性；几何交叉不新增连接，共享节点的匝道连接保持有效。
- 缺失或非法节点、重复道路 ID、退化段及未支持方向的诊断；缺失节点不跨缺口连线。
- 20 项方向测试、20 项构边测试、4 项报告测试，以及 C 任务准备与武汉全量检查记录。
- 可序列化构边报告：明确输入道路未做模态过滤，并列出无方向高速匝道、条件方向及未知方向的排除明细。
- 模块尚未接入现有 loader 或 B 的 Graph；M1 图范围、方向排除及路径/ID 约定的确认请求已整理为本地 Issue 草稿，待用户审核发布。

### Added(Sprint 1 · E 前端交互)

- 新增 `web/src/map/` 模块（公开入口 `index.ts`）：底图可用性预探测与无底图降级样式、路网 deck.gl `PathLayer` 创建。`main.ts` 已改为经该模块调用，原 Carto 死代码一并移除（PR #15）。
- 新增 `web/src/panels/property/` 道路属性面板：
  - `property-view-model.ts` 把 GeoJSON 要素转换成视图模型，与 DOM 解耦，可在 Node 环境单测而无需引入 jsdom；
  - `property-panel.ts` 只负责渲染，复用 `charts/ui.css` 的 `.gis-panel` / `.gis-badge` 视觉原语；
  - 展示全部 OSM 标签（原 Popup 截断为 6 个）、固定侧栏、全部用 `textContent` 写入以规避注入。
- 面板块由宿主（`main.ts`）挂载到 `#side-panels`，与 D 的统计/权重面板共用同一视觉基线，未引入新主色。
- 新增 `GET /api/path`（`server/src/api/routes.ts`）：按 `from=lon,lat&to=lon,lat&metric=distance|time`
  把点击坐标吸附到最近图节点后运行 Dijkstra，返回 `PathResponse`（`shared` 新增，`extends PathResult`
  的非破坏性扩展），包含吸附后的起终点坐标与整条路径折线，前端可直接绘制。
  不可达返回 404，避免把 `Infinity` 下发到 JSON；时间权重复用 D 的 `createEdgeWeight`。
  配套 7 项路由与吸附测试（`server/src/api/routes.test.ts`）。
- 新增 `web/src/map/path-selection.ts` 起终点选路：点击地图取经纬度后调 `/api/path`，
  用 deck.gl `ScatterplotLayer` 画起终点标记、双层 `PathLayer`（白描边 + 金色主线）高亮路径；
  与道路属性弹窗互斥，切换权重目标后自动按新目标重算。
- 右侧统计/权重面板改为两个独立分区（`.side-section`）：标题条固定、内容区各自滚动、
  支持点击收起；`#side-panels` 由整列滚动改为 flex 分区，避免权重面板被挤到滚动底部。

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

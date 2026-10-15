# D · Sprint 0/1 权重与统计模块交付说明

日期：2026-10-14。状态：权重/统计模块、ECharts 图表封装、统计与权重面板均已完成；全仓 98 项测试通过（本次新增 49 项），shared/server/web 三包 typecheck、全仓 ESLint 与 Prettier 通过。**模块尚未接入服务端启动流程与主界面**，需要的集成动作已整理为 issue，见 §5。

## 1. 范围与边界

Sprint 0/1 的主线是 C 的拓扑构建与 B 的图引擎，D 在这两周内交付的是"让图有代价、让结果可度量"的地基：

| 交付物 | 目录 | 说明 |
|---|---|---|
| 距离度量 | `server/src/weights/geo.ts` | Haversine，与 B 的默认边权同公式同半径 |
| 等级限速模型 | `server/src/weights/speed.ts` | highway 等级 → 限速(km/h)，里程 → 通行时间 |
| 可注入权重函数 | `server/src/weights/weight.ts` | 距离/时间两种边权，配置可由前端驱动 |
| 网络统计 | `server/src/weights/stats.ts` | 里程、等级分布、边长分布、通行时间、拓扑指标占位 |
| REST 路由插件 | `server/src/weights/routes.ts` | `/api/stats`、`/api/weights/profile`，待 A 注册 |
| 图表封装 | `web/src/charts/` | ECharts 按需装配 + 深色主题 + 图表工厂 |
| 统计面板 | `web/src/panels/stats/` | KPI + 三张图 + 拓扑指标区 |
| 权重面板 | `web/src/panels/weight/` | 优化目标、速度系数、等级限速表、时间预估 |

不做：拥堵时间槽函数、权重着色动画、等时圈（Sprint 3）；转向限制、多模态（Sprint 2）。D 未修改任何他人目录，`web/package.json` 新增 `echarts` 依赖是为落实立项文档 §3.1 的图表选型，已在 PR 描述中说明。

## 2. 服务端设计

### 2.1 距离与时间

`haversineMeters(a, b)` 使用与 B 的 `server/src/graph/dijkstra.ts` 相同的地球半径 6371000 m 与公式，对 `sqrt` 参数做 [0,1] 截断防止浮点误差产生 NaN。这一点不是风格问题：若两条链路各用一套半径，"里程最短"与"时间最短"会在同一条边上给出不一致的长度。

`travelSeconds(distanceMeters, speed)` 在速度非正时返回 `Infinity` 而不是抛错，让"不可通行"直接参与最短路取最小运算。

### 2.2 可注入权重函数

B 在 PR #7 中预留的注入点是 `EdgeWeightFn = (edge: RoadEdge) => number`——只有边，没有几何与等级。因此 D 的权重函数是**闭包**：`createDistanceWeight(context)` / `createTimeWeight(context, profile)` 先捕获节点坐标表与 way→等级表，再返回符合该签名的函数。

```ts
// A 组装时唯一需要调用的入口
const weightFn = createEdgeWeight(network, profile);   // metric 决定米还是秒
dijkstra(graph, source, target, weightFn);
```

三个设计决定，均为答辩可讲清的理由：

1. **端点缺失的边返回 `Infinity` 而不是 0**。0 会让 Dijkstra 把一条缺端点的边当成免费捷径，直接产生错误路径。
2. **按边 id 记忆化里程**。同一网络下 Dijkstra 会反复访问同一条边，记忆化把三角函数开销从 O(松弛次数) 降到 O(边数)。
3. **`normalizeWeightProfile` 兜住一切外部输入**。speedFactor 截断到 (0, 3]，非法限速覆盖项直接丢弃——查询串与前端面板都不可信。

`WeightProfile` 新增 `metric: 'distance' | 'time'` 字段，把"优化目标"纳入配置而不是散落在调用处；默认 `'time'`。注意 B 的 `dijkstra` 不传 weight 时等价于 `metric='distance'`，两者是显式选择关系，不冲突。

### 2.3 网络统计

`computeNetworkStats(input, options)` 一次遍历同时产出里程、时间、等级分布与边长分档，复杂度 O(E log E)（排序取中位数）。两个口径决定必须写清楚：

- **端点缺失的边整体跳过**，不按 0 米计入。否则"未知长度"会伪装成极短边，同时拉低平均边长、污染直方图。
- **`totalTravelSeconds` 恒按限速估算，与 `profile.metric` 无关**。metric 只决定路径优化的目标；统计里的时间是"这个路网跑起来要多久"，两者语义不同。

直方图分档固定为 0–20 / 20–50 / 50–100 / 100–200 / 200–500 / 500–1000 / ≥1000 米，左闭右开。

**拓扑指标是占位，不是零值。** `NetworkStats.topology` 为 `null` 时同时返回 `topologySource: 'pending'`，前端据此显示"待接入"而不是一片 0——把"没有数据"和"数据为零"区分开，是统计模块的基本操守。接入后由 `toTopologyMetrics()` 把 B 的 `TopologyStats`（含 `Map` 类型的度分布）转换为可序列化数组。

### 2.4 REST 路由插件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/weights/profile` | 默认权重配置 + 各等级默认限速表（前端面板的基准） |
| GET | `/api/stats` | 网络统计；支持 `metric`、`speedFactor`、`speedKmh=primary:45,residential:25` |

`/api/stats` 按请求实时计算，未做缓存。武汉全量约 120 万边时需要预计算或缓存，已在 issue 中标注为接入时的性能项。

## 3. 前端设计

### 3.1 charts 模块

- `setup.ts`：ECharts **按需装配**（BarChart/PieChart + Grid/Legend/Tooltip + CanvasRenderer），不整包引入。
- `theme.ts`：注册 `gisalgo-dark` 主题，配色严格取自 AGENTS.md 样式基线（#101418 底 / #d7dde6 字 / #f2c66d 金），未引入新主色。
- `factory.ts`：`horizontalBarOption` / `donutOption` / `histogramOption` 三个纯函数工厂 + `createChart` + `autoResize`（ResizeObserver，返回停止函数防泄漏）。选项内不出现业务字段名，业务映射留在面板。
- `contract.ts`：**临时契约镜像**，见 §5。
- `format.ts`：`formatCount / formatKilometers / formatDuration / formatPercent / formatSpeed` 统一口径。

### 3.2 统计面板

KPI 区（节点/边/道路/总里程/总通行时间/平均与中位边长）+ 三张图 + 拓扑指标区 + 底部口径说明。底部那行说明是有意的：把"当前用的什么限速、里程最多的等级是谁、占比多少"摊出来，避免图表好看但讲不清口径。

### 3.3 权重面板

优化目标（最快时间/最短距离）、全局速度系数滑杆、各等级限速表（可编辑，改动行高亮）、预计总通行时间与逐等级时间。

关键取舍：**面板里的通行时间是即时预估，不是权威值。** 拖滑杆时按已收到的等级里程本地换算（与服务端 `createTimeWeight` 同一换算式），配置变化后由服务端 `GET /api/stats` 重算权威值。这样滑杆零延迟，又不产生"前端另算一套真相"。基准限速优先取 `/api/weights/profile` 的 speedTable；未取到时由统计平均速度反算（先除掉 `stats.profile.speedFactor` 还原基准），并在面板说明里注明。

选择"最短距离"时速度相关控件自动禁用——速度系数对里程最短本来就不起作用，UI 不该假装它能。

### 3.4 独立预览页与离线示例

`web/src/panels/stats/demo.html`（Vite 下访问 `/src/panels/stats/demo.html`）优先请求实时接口，失败时降级到 `sample.ts` 离线示例并在页头标注"离线示例(合成路网,非真实统计)"。示例数据由一次性脚本用**真实的** `computeNetworkStats` 在 18×18 合成路网上算出（324 节点 / 1258 边 / 368.6 km），不是手填的假数；脚本未提交。页面另提供"切换拓扑占位态"按钮，用于同时查看拓扑指标"已接入"与"待接入"两种渲染。

## 4. 测试与验证

新增 49 项 Vitest 测试（geo 7、speed 8、weight 22、stats 12），覆盖：

- Haversine 的已知距离（1° 纬度 ≈ 111.19 km、北纬 30° 经度收缩、武汉—北京千公里量级）与对称性；
- 限速表全部为正、未知等级回退、速度非正返回 `Infinity`；
- 距离/时间权重与手算一致、端点缺失返回 `Infinity`、不同上下文缓存互不串值、速度系数与覆盖表生效；
- `normalizeWeightProfile` 对非法输入的兜底与上界截断；
- 统计的口径断言：缺失边跳过、占比和为 1、等级平均速度还原为默认限速、直方图各边只落一档、空集全零而非 NaN、响应体 JSON 往返一致。

全仓 98 项测试通过；`tsc -p shared|server|web`、ESLint、Prettier 全部通过。

## 5. 待团队成员补充（占位与 issue）

| # | 待办 | 负责人 | 说明 |
|---|---|---|---|
| 1 | 在 `server/src/index.ts` 注册权重路由插件 | **A** | `await app.register(registerWeightRoutes, { network })`，并补一份 wayId → highway 表（可从 `/api/network` 的 features 或 C 的 `TopologyResult.ways` 导出）。D 不改 A 的目录 |
| 2 | 将 `WeightProfile` / `NetworkStats` 等提升到 `shared/src/index.ts` | **A** | 与 B 的 issue #4 同批评审；提升后删除 `web/src/charts/contract.ts` 镜像，前后端改从 `@gisalgo/shared` 导入 |
| 3 | 提供拓扑指标填充 `stats.topology` | **B** | PR #7 的 `computeTopologyStats(graph)` 产物经 A 传入；`degreeDistribution` 为 `Map`，由 `toTopologyMetrics()` 负责序列化 |
| 4 | 确认 way→highway 的权威来源与口径 | **C** | `buildTopology` 的 `ways` 已带 highway；确认 A 取数路径，避免出现第二份等级表 |
| 5 | 将统计/权重面板挂载进主界面布局 | **E** | 面板为自包含组件（`createStatsPanel()` / `createWeightPanel()`），E 在 `web/src/map` 的布局中预留挂载点即可；`web/src/main.ts` D 未改动 |
| 6 | `/api/stats` 在全量数据上的性能预算 | **A** | 当前按请求实时计算；120 万边规模建议预计算或缓存 |

## 6. 已知限制与 Sprint 3 衔接

- 限速是"设计通行能力"，不是实时路况；Sprint 3 的拥堵系数在 `WeightProfile` 上扩展为时间槽函数，接口形态已预留（`speedOverridesKmh` 即逐等级覆盖的先例）。
- 等级集合须与 `shared` 的 `HIGHWAY_COLORS` 同步维护，新增等级两处都要补。
- 统计输入要求 way→highway 表；在 A 接入前，任何"真实统计"都无法出数——这也是本模块先交付占位态而非假数据的原因。

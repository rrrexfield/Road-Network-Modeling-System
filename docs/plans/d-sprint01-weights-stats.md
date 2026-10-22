# D · Sprint 0/1 权重与统计模块交付说明

日期：2026-10-14（2026-10-16 复审更新）。状态：权重/统计模块、ECharts 图表封装、统计与权重面板均已完成；已 rebase 到含 B 图引擎（PR #7）与契约冻结（PR #14）的最新 main；全仓 124 项测试通过（本次新增 55 项），shared/server/web 三包 typecheck、全仓 ESLint 与 Prettier 通过。**模块尚未接入服务端启动流程与主界面**，需要的集成动作已整理为 issue（#9–#13），见 §5；对 PR #8 评审意见的逐条处理见 §7。

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

`PR #14` 后 `TopologyStats` 已由 A 冻结进 `shared/src/index.ts`，因此本模块**不再维护镜像**：

- 入参 `options.topology` 直接收 `TopologyStats`，删掉了原先的 `TopologyMetricsSource` 本地副本；
- 出参 `TopologyMetrics` 改为**派生**而非平铺——`extends Omit<TopologyStats, 'degreeDistribution'>`，只重写 `degreeDistribution` 为 `{degree,count}[]`。这样 shared 增改字段时本模块自动跟随，不会出现第二套口径；
- `topologySource` 的取值从 `'server/src/graph(graph-engine)'` 改为 `'graph-engine'`。原先把模块路径当枚举值，目录一改名就失效，现在用语义名；`'pending'` 保持不变，前端据此区分两种状态。

`degreeDistribution` 在 `toTopologyMetrics` 里按度升序输出：B 侧的 Map 是节点迭代序（无序），若不在 API 层排序，同一份数据每次刷新都可能呈现不同顺序。这条排序是 D 侧的呈现约定，不改变 B 的统计语义。

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

### 4.1 测试覆盖

新增 55 项 Vitest 测试（geo 7、speed 8、weight 26、stats 14），覆盖：

- Haversine 的已知距离（1° 纬度 ≈ 111.19 km、北纬 30° 经度收缩、武汉—北京千公里量级）与对称性；
- 限速表全部为正、未知等级回退、速度非正返回 `Infinity`；
- 距离/时间权重与手算一致、端点缺失返回 `Infinity`、不同上下文缓存互不串值、速度系数与覆盖表生效；
- `normalizeWeightProfile` 对非法输入的兜底与上界截断；
- 统计的口径断言：缺失边跳过、占比和为 1、等级平均速度还原为默认限速、直方图各边只落一档、空集全零而非 NaN、响应体 JSON 往返一致；
- **B 的 `EdgeWeightFn` 前置条件**：图内边（两端点均可解析）在 `metric='distance'`/`'time'` 下代价均 ≥0 且有限（4 项）；极小限速下不产生 NaN；图外边（端点缺失）返回 `Infinity`；
- **契约派生的稳定性**：直接用 shared 的 `TopologyStats` 构造入参、度分布按度升序、派生字段与 shared 语义一致（2 项）。

全仓 124 项测试通过；`tsc -p shared|server|web`、ESLint、Prettier 全部通过。

### 4.2 边长口径（与 B 的 `Graph.edgeLength` 的关系）

统计当前用 `geo.ts` 的 `haversineMeters` 按**原始 float64 坐标**实时计算边长，服务于"还没有组装出 Graph"的场景。B 的 `Graph.edgeLength(id)` 是**装载期预计算**的同源 Haversine，但坐标以 `Float32Array` 存储，单边存在量化误差（分轴最坏 ~0.7 m），因此两者数值**不严格相等**。

- 公式与地球半径一致（6371000 m），差异只来自坐标存储精度，不来自算法；
- 统计口径以本模块为据时，报告的"总里程"与路由算出的"路径长度"可能有米级差异，属预期；
- **待 A 组装出 Graph 后，统计里程应改为取 `edgeLength`**，使"统计里程"与"路径权重"严格同源。在此之前以本节为口径依据，不在响应体里引入新的口径字段（避免未评审即扩大契约面）。

### 4.3 前端 `metric` 透传

`fetchStats` 原先只透传 `speedFactor` 与 `speedKmh`，未透传 `metric`。后果是：面板切到"最短距离"后，`/api/stats` 回显的 `profile.metric` 仍是服务端默认的 `'time'`，权重面板右上角的模式徽标与实际选择不一致。数值本身不受影响（统计总时间按设计就与 metric 无关），但属于肉眼可见的不一致，已修复：`fetchStats` 增加 `metric` 参数，`demo.ts` 一并透传。

## 5. 待团队成员补充（占位与 issue）

| # | 待办 | 负责人 | issue | 说明 |
|---|---|---|---|---|
| 1 | 在 `server/src/index.ts` 注册权重路由插件 | **A** | [#9](https://github.com/rrrexfield/Road-Network-Modeling-System/issues/9) | `await app.register(registerWeightRoutes, { network })`，并补一份 wayId → highway 表（可从 `/api/network` 的 features 或 C 的 `TopologyResult.ways` 导出）。D 不改 A 的目录 |
| 2 | 将 `WeightProfile` / `NetworkStats` 等提升到 `shared/src/index.ts` | **A** | [#10](https://github.com/rrrexfield/Road-Network-Modeling-System/issues/10) | 与 B 的 issue #4 同批评审；提升后删除 `web/src/charts/contract.ts` 镜像，前后端改从 `@gisalgo/shared` 导入。**#14 后本项范围已收窄**：`TopologyStats` 已进 shared，D 侧已改为引用 + 派生；剩下待冻结的是 `WeightProfile`/`NetworkStats`/`HighwayStat`/`LengthBucket`/`TopologyMetrics`，冻结时 `TopologyMetrics` 请保持"派生自 `TopologyStats`"的形态 |
| 3 | 提供拓扑指标填充 `stats.topology` | **B** | [#11](https://github.com/rrrexfield/Road-Network-Modeling-System/issues/11) | PR #7 / #14 已合入，`computeTopologyStats(graph)` 产物经 A 传入；`degreeDistribution` 为 `Map`，由 `toTopologyMetrics()` 负责序列化与按度升序。M1 为全道路拓扑（与 C 构边口径一致，不做模态过滤），模态子图待准入规则立项后再另立口径 |
| 4 | 确认 way→highway 的权威来源与口径 | **C** | [#12](https://github.com/rrrexfield/Road-Network-Modeling-System/issues/12) | `buildTopology` 的 `ways` 已带 highway；确认 A 取数路径，避免出现第二份等级表 |
| 5 | 将统计/权重面板挂载进主界面布局 | **E** | [#13](https://github.com/rrrexfield/Road-Network-Modeling-System/issues/13) | 面板为自包含组件（`createStatsPanel()` / `createWeightPanel()`），E 在 `web/src/map` 的布局中预留挂载点即可；`web/src/main.ts` D 未改动 |
| 6 | `/api/stats` 在全量数据上的性能预算 | **A** | 并入 #9 | 当前按请求实时计算；120 万边规模建议预计算或缓存 |

## 6. 已知限制与 Sprint 3 衔接

- 限速是"设计通行能力"，不是实时路况；Sprint 3 的拥堵系数在 `WeightProfile` 上扩展为时间槽函数，接口形态已预留（`speedOverridesKmh` 即逐等级覆盖的先例）。
- 等级集合须与 `shared` 的 `HIGHWAY_COLORS` 同步维护，新增等级两处都要补。
- 统计输入要求 way→highway 表；在 A 接入前，任何"真实统计"都无法出数——这也是本模块先交付占位态而非假数据的原因。
- `EdgeWeightFn` 暂不冻结（#14 同步区已记明）：当前签名 `(edge) => number` 不含边长，Sprint 3 实现行程时间权重需 A/D/B 评审扩展。本模块在扩展时仍须满足"返回 ≥0 且有限"的前置条件。

## 7. PR #8 评审意见处理记录（2026-10-16）

A 在 PR #8 提出两点：先 rebase 最新 main，再按已合并的 PR #14 适配。逐条落实情况：

| # | 评审意见 | 落实 |
|---|---|---|
| 1 | rebase 最新 main | 已 `git rebase origin/main`（main = 21bc6b6，含 PR #7 图引擎与 PR #14 契约冻结）。冲突集中在 README.md / CHANGELOG.md / AI日志.md 三个文档，均为追加型冲突，已保留双方内容 |
| ① | 删除 `TopologyMetricsSource` 镜像，改引 `@gisalgo/shared` 的 `TopologyStats`；`TopologyMetrics` 派生而非平铺；`topologySource` 改用语义名 | 已全部落实，详见 §2.3。`web/src/charts/contract.ts` 的 `TopologyMetrics` 同样改为派生，前端拓扑部分不再是第二份定义 |
| ② | 边长可复用但注意口径来源 | `haversineMeters` 保留为无 Graph 场景的实现，并在 `geo.ts` / `stats.ts` 头部与 §4.2 注明：与 `Graph.edgeLength` 数值不严格相等（Float32 量化，单边最坏 ~0.7 m）；待 A 组装 Graph 后统计里程改取 `edgeLength`，切换前以 §4.2 为口径依据 |
| ③ | `EdgeWeightFn` 前置条件（≥0 且有限） | 已在 `weight.ts` 的 JSDoc 写明该前置条件，并说明"图内注入路径上成立"的理由：`Graph.addEdge` 已校验端点存在，`Infinity` 分支只在图外场景触发。新增 4 项测试锁定该约束 |
| ④ | M1 全图 vs 模态子图、`degreeDistribution` 排序 | 已在 `stats.ts` JSDoc 标注 M1 为全道路拓扑（与 C 构边口径一致）；`toTopologyMetrics` 维持按度升序，并新增排序断言测试 |
| ⑤ | 图引擎导出面收敛 | 已确认：D 侧未引用 `degreeDistribution` / `danglingNodes` 等已收敛的导出，接入点只有 `computeTopologyStats` 的产物类型 |
| ⑥ | #9 与 wayHighway | 按 A 的方案（GeoJSON features 先跑通）执行，D 不动 `server/src/index.ts` |

顺带修复的自查项：前端 `fetchStats` 未透传 `metric`（见 §4.3）。

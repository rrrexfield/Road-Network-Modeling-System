# D · Sprint 2 实现说明:属性完整率统计与多模态权重模型

> 角色 D(权重与统计工程师)· Sprint 2 第 5–6 周 · 作业 2:转向限制与多模态
> 关联:issue #23(E → D,/api/stats 缺少属性完整率字段)、issue #34(跨模态路径)、PR #41 评审
> 分支:`feature/d-sprint2-stats-multimodal`(基于 main `769504a`)

## 0. 本轮 D 的任务边界

Sprint 2 的四项主任务(状态空间 B、数据模型/SQLite C、编辑器 E、REST A)均已合入或
在评。D 名下目录(`server/src/weights/`、`web/src/charts/`、`web/src/panels/stats/`、
`web/src/panels/weight/`)在 Sprint 2 语境下的缺口经盘点为两项:

1. **issue #23**:契约已冻结(`AttributeCompletenessReport`,`NetworkStats.attributeCompleteness`
   为可选字段),但服务端从未填充、前端从未展示——E 在统计面板侧一直看不到该区块。
2. **多模态权重缺口**:`/api/path?mode=walk|bike|bus` 已能按模态子图算路(A,PR #39/#40),
   但边权仍用汽车限速表——步行 1 km 按 fallback 30 km/h 计 2 分钟,而非真实 ~13 分钟,
   跨模态路径(issue #34)的时间口径因此失真。模态速度模型是 D 的权责范围。

另:对 E 的 PR #41(改动 D 目录 3 个展示文件)完成 owner 评审并批准(见 PR 评论)。

## 1. 属性完整率(issue #23)

### 口径(已在 issue #23 由 A 冻结,不再赘述理由)

- **按 way 统计**:属性来自 way 标签;同一 way 拆成多条有向边,按边统计会重复稀释
  (武汉 69,382 way 对应 119 万有向边)。
- **只统计原始标注**:`maxspeed` 原始标注仅 0.93%,其余 99% 来自按等级推断;
  推断值不计入 `filled`,否则完整率虚高到接近 100%,与"限速数据实际缺失"的结论相反。

### 实现(`server/src/weights/stats.ts`)

- `StatsInput` 新增可选 `ways?: ReadonlyMap<number, StatWay>`(`StatWay = { highway, tags }`,
  只读两张字段,不依赖 io 的完整 Way 类型;`TopologyResult.ways` 的 `WayProperties`
  结构兼容,可直接传入)。
- `computeAttributeCompleteness(ways)`:O(W·k),k=5(name/maxspeed/lanes/surface/oneway),
  空串/纯空白标签视为未填写;空表返回 total=0 且 ratio=0,不产生除零。
- `computeNetworkStats` 在 `input.ways` 提供时填充 `attributeCompleteness`,未提供时
  **保持缺省**(契约语义:服务端尚未提供;`JSON.stringify` 自动省略)。
- 不改 A 的 `server/src/api/`。接口形态 D 自定(符合 issue #23 的授权),A 侧接线为
  一行:`registerWeightRoutes` 的 `network` 入参补 `ways: topology.ways`(已提 issue,
  见 §4)。

### 前端(`web/src/panels/stats/`)

- 新增「属性完整性」卡片:五个属性的横向条形图(0–100%,`ratio × 100` 保留 1 位)。
- `attributeCompleteness` 缺省时:图表 `clear()` 并显示**「待接入」占位覆盖层**,
  不显示 0%——"没有数据 ≠ 完整率是 0"(契约注释原文)。
- 样式沿用 `charts/ui.css` 基线(深色 + 金点缀),占位覆盖层为本目录内新增 CSS 类。

## 2. 多模态权重模型(`server/src/weights/mode-weight.ts` 新文件)

### 设计

```
里程(模态间共享,同一 Haversine 口径)
  └─ 模态速度表(本模块核心新增)
       car  → 直接复用 speed.ts 的汽车限速表(createEdgeWeight 零重复)
       bus  → 汽车限速 × BUS_SPEED_FACTOR(0.8,停站/启停折减);busway 公交专用道单独 20
       walk → 模态独立表(steps 2.0 / 主干路沿线 4.0 / 兜底 4.5)
       bike → 模态独立表(cycleway 18 / 主干路 10–12 / 共享道路 6 / 兜底 12)
  └─ × 全局速度系数 speedFactor(与 effectiveSpeedKmh 同一合成顺序,覆盖语义跨模态一致)
```

公开 API(经 `server/src/weights/index.ts`):

- `modeSpeedKmh(mode, highway)` / `effectiveModeSpeedKmh(mode, highway, profile)`
- `createModeEdgeWeight(context, mode, profile?): EdgeWeightFn` —— 与 B 的
  `dijkstra` / `dijkstraWithTurnRestrictions` 的注入签名一致;car 模态委托
  `createEdgeWeight`,其余模态 distance 口径复用 `createDistanceWeight`(保证跨模态
  比较时"距离"含义一致),time 口径按模态速度换算。
- `transferPenaltySeconds(kind)` / `TRANSFER_PENALTY_MINUTES` —— 换乘罚时(时间/成本
  口径,不计入 `PathResult.distance`,见 issue #34 的 A 决策)。

### 占位值声明(需要团队补充的部分)

| 参数                               | 当前值 | 性质               | 待补事项                                                                 |
| ---------------------------------- | ------ | ------------------ | ------------------------------------------------------------------------ |
| `TRANSFER_PENALTY_MINUTES.subway`  | 5 分钟 | 行业常用估计       | C 的核验换乘连接(issue #34)落地后,按"步行接驳距离 ÷ 步速 + 站台等待"标定 |
| `TRANSFER_PENALTY_MINUTES.bus`     | 3 分钟 | 行业常用估计       | 同上                                                                     |
| `TRANSFER_PENALTY_MINUTES.parking` | 5 分钟 | 行业常用估计       | 同上;停车换乘含找车位冗余                                                |
| walk/bike 分档速度                 | 见上表 | 城市交通工程经验值 | 如需实测标定,依赖作业三的时间槽模拟数据                                  |

`/api/path` 的 mode 分支当前仍调用 `createEdgeWeight`(汽车模型)——D 不能改 A 的
`server/src/api/`,已提 issue 请 A 将其替换为 `createModeEdgeWeight`(一行改动)。
**在 A 接线前,`/api/path?mode=walk` 的时间结果仍按汽车速度计算,这是已知限制**,不影响
distance 口径(模态间里程本就一致)。

## 3. 测试与验证

- `mode-weight.test.ts` 新增 14 项:car 与既有模型逐边一致(防回归)、walk/bike/bus
  速度表与时间换算、distance 口径模态无关、覆盖表/系数合成顺序与汽车模型一致、
  端点缺失 Infinity 口径、罚时正有限。
- `stats.test.ts` 新增 6 项:按 way 统计口径、空串/空白不计入、空表除零、
  computeNetworkStats 缺省不产出该字段、提供 ways 时全量 way 口径(不参与构边的 way
  也计入 total)。
- 全仓测试、三包 typecheck、ESLint、Prettier 结果见 CHANGELOG 对应条目。

## 4. 依赖与交接(跨成员)

- **A**(issue 已提):① `/api/path` 的 mode 分支改注入 `createModeEdgeWeight`;
  ② `registerWeightRoutes` 的 network 入参补 `ways: topology.ways`,并在交付后把
  `NetworkStats.attributeCompleteness` 收紧为必填(issue #23 承诺)。
- **E**:PR #41 已评审批准;属性完整性卡片与该 PR 对 `stats-panel.ts` 的重构有重叠,
  合入顺序先 #41,本分支 rebase 适配(两个文件 owner 均为 D)。
- **B**:issue #34 跨模态搜索实现时,换乘罚时直接消费 `transferPenaltySeconds(kind)`;
  模态间代价合成口径(罚时加在哪一段、是否进 SearchTrace)需 B/D/A 对齐后再冻结。

## 5. 与 Sprint 3 的衔接

- 模态速度表与 `WeightProfile.speedOverridesKmh` 的合成顺序保持一致,M3 的拥堵时间槽
  函数只需在 `effectiveModeSpeedKmh` 之上叠加时段系数,不再动签名。
- 属性完整率面板口径文档化后,M3 的「统计分析」验收项可直接引用本区块。

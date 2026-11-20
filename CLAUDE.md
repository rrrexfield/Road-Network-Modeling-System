# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# GISAlgo 项目协作规范(所有 AI Agent 必读必守)

本项目是 **5 人小组多人协作课程项目**(分工与目录所有权见 `docs/立项文档.md` §4.1)。任何 AI Coding Agent(Claude、Codex、Cursor 等)在本仓库工作前必须完整阅读并服从本规范。本规范与 `docs/立项文档.md` 或教师最新通知冲突时,以后者为准,并应同步修订本文档。

## 一、工作前置门禁(强制)

1. **角色确认**:动代码前,先依据立项文档 §4.1 确认当前用户角色(A–E)。用户未提及自己的角色时,**必须先询问角色**,确认后才能修改代码,且修改范围严格限制在该角色名下目录:

   | 角色 | 唯一修改权目录 |
   |---|---|
   | A 组长/PO·平台与集成 | `server/src/api/`、`server/src/index.ts`、`web/src/api-client/`、`shared/`、`scripts/`、根配置文件 |
   | B 图引擎算法 | `server/src/graph/` |
   | C 数据与拓扑 | `server/src/io/`、`server/src/topology/` |
   | D 权重与统计 | `server/src/weights/`、`web/src/charts/`、`web/src/panels/weight/`、`web/src/panels/stats/` |
   | E 前端交互 | `web/src/map/`、`web/src/panels/editor/`、`web/src/panels/property/`、`web/src/replay/` |

2. **计划检查**:收到"帮我实现…""帮我写…代码"等实现类请求时,先检查本会话/仓库是否已有既定计划;若没有,**提示用户先使用计划模式(plan mode)确定方案**,确认后再动手实现。

## 二、Git 规范(强制)

- **严禁直接 commit / push 到 `main`**;用户要求提交或推送时,先提醒"请在新建分支中提交",并主动询问是否需要协助生成分支名与 commit 信息。
- 分支命名:`<type>/<简述>`,如 `feature/ws-channel`、`fix/parser-bbox`;`type ∈ feature | fix | docs | chore | test`。
- Commit 信息:Conventional Commits 风格(`feat:` `fix:` `docs:` `chore:` `test:`),正文说清"改了什么、为什么"。
- 每次功能提交同步更新 `docs/CHANGELOG.md`;每完成一个较大的功能模块、或准备推送前,须将 `README.md` 更新至最新(命令、结构、约定有变即改)。
- **⚠️ 严禁将 AI(claude、codex 等)加入 contributor**:commit 不带任何 AI 署名(禁止 `Co-authored-by:`、`Generated with` 等标记),提交作者只能是用户本人。
- 提交前 `git status` 复查暂存内容;严禁提交 `data/` 下大文件与 `data/derived/` 生成物(已 gitignore)。
- 每次 AI 协作按 `docs/AI日志.md` 模板如实记录(课程硬性要求)。

## 三、多人协作同步区(随项目增量更新)

**C作业三最后更新：2026-11-12（feature/compression-topology-input，待审）**

topology新增CompressionWayIndex（way原属性只读查询/边界比较）及collectCompressionProtectedNodes（当前图禁转/换乘节点合并）；io的PersistentTurnService新增getCompressionState返回当前禁转via节点和实例内版本。成功setTurns后版本递增、失败不变；缓存绑定运行时实例，不跨实例比较版本。无shared/API/数据库格式改动，不重复B的邻接/度-2/方向判定；A/B仍须接入。交接见docs/plans/c-sprint3-compression-input.md。

**C节点准入补充最后更新:2026-11-06（fix/node-access分支，待A评审接入）**

topology的buildModalTopology增加可选第四参数NodeTags，返回nodeAccess（checked/excludedNodes/excludedEdgeCount）；未传保持旧行为并checked=false。按模式过滤受限/未决节点的相邻段，不跨缺口补边，剩余edgeId和原始way属性不改；unknown/无许可屏障保守排除，并非实景禁行认证。io/createTurnRuntime已传nodeTags，A的ModalRuntimeRegistry两处调用尚需接入并重建Graph/转向/nearest索引及换乘缓存；未改A/B/E或shared。399项测试及类型/lint/build通过，策略和武汉实测见docs/plans/c-node-access-ready.md。线上功能尚未据此完成修复。

> **更新义务**:本节是全员对齐的关键约定。每当 API、契约类型、目录结构或规范发生变化,Agent 必须在完成改动后**自动总结并更新本节**,并在"最后更新"处标注日期。

**最后更新:2026-11-12(PR #62 合入 main:模态路径改用轻量邻接视图;作业三分工确认 issue #63)**

2026-11-12 A 两件事。**①PR #62(B 的禁转路径内存优化)已重整到最新 main 并合入 main(`716b6c8`)。** 核心变更:`ModalRuntime.graph` 由完整 `Graph` 改为轻量 `ReadonlyAdjacency`(`createAdjacencyView` 产物:只建出边邻接 + 边 id 索引,复用边对象,不预计算边长/出入度/紧凑坐标);`dijkstraWithTurnRestrictions` 入参同步泛化为 `ReadonlyAdjacency`,默认边权改为按坐标现算 Haversine;C 的 `IntersectionTurnIndex`/`TurnRestrictionTable` 不再各拷一份边对象(单模态运行时边对象从 3 份降到 1 份)。**对外契约未变**(`shared/` 未动)。A 复核 API 侧时发现 B 的泛化只覆盖了 `dijkstraWithTurnRestrictions`,跨模态搜索的 `ModalLayer.graph` 仍写死 `Graph`,导致 `server/src/api/multimodal-path.ts` typecheck 报 TS2322、CI 无法通过;已把 `ModalLayer.graph` 与 `reconstructSegment` 的图参数放宽为 `ReadonlyAdjacency`(`Graph` 结构上满足该接口,既有调用与测试零回归)。合入后全仓 401 项测试(50 文件)、shared/server/web 三包 typecheck、全仓 lint、前端生产构建全绿。内存数值(~106 MB / ~160 MB / ~266 MB)为**合成 99 万边规模的估算**,非武汉端到端实测。

**②作业三分工确认(issue #63,C 发起)。** 对照任务书 G2 第 3 次作业(5 项任务内容 / 4 项产出物 / 5 项评分维度),A 确认 C 提的 4 项交付全部保留、边界不变(C 仅在 `server/src/io/`、`server/src/topology/` 及相关文档)。**关键口径**:度-2 用**去重后的邻居数**判定(`|{ w | 存在边 v→w 或 w→v }| == 2`),**不能直接拿现有有向度统计判断**——双向道路的普通中间点有向度 = 4 但邻居数 = 2,与 `TopologyStats` 的有向度口径不同。**保留集五类**(命中即不压缩):禁转 via 节点 / 换乘连接涉及的节点(**路网节点 id,不是设施展示 id**)/ 属性变化点(等级、限速、oneway、权限)/ 方向模式变化点 / 模态准入边界点。**映射口径**:压缩边记录原图有向边序列 + 起止原图节点,路径还原按序列展开拼接;权重累计距离口径 Σ 原边长度、时间口径逐原边算时间再求和(不先平均速度再乘总长)。**禁转编辑后的更新**:禁转仍按原图边对存储,禁转集合变化 → 保留集变化 → 压缩图按 `(mode, 禁转表版本号)` **惰性重建**(版本号 +1 即失效),不新增持久化表、不做常驻全量缓存。新增 `docs/plans/a-sprint3-division.md`;并按任务书拆出三个缺口单:#64(B 度-2 压缩 + 映射还原 + 对比报告,25% 评分项)、#65(D 拥堵系数/事件影响 + 可达性分析)、#66(E 按车速/拥堵着色 + 权重时间变化动画)。**现状盘点**:压缩模块为零,拥堵/事件权重与可达性分析未做,权重可视化只有配置侧没有表达侧;权重配置界面与统计(里程/等级/连通性/属性完整率)已具备。CH 收缩层次为可选加分,本期不排期(立项文档 §2.2)。

**最后更新:2026-11-05(A 完成 Sprint 2 集成:PR #39/#40/#42 已合入 main、派生数据已重建、前端禁转端到端已打通、新增路口就近查询接口;issue #34 仍开放)**

2026-11-05 A 集成(issue #38 闭环):**PR #39(B 边扩展 Dijkstra)、#40(/api/path 接入禁转)、#42(C 接驳表)已合入 main**,三者代码零冲突,本地组合验证 268 项测试全绿。`/api/path` 新增 `mode` 查询参数:**缺省走基础图、不施加禁转**(与作业一一致),显式给 mode 走该模态子图并注入 `PersistentTurnService.isForbidden` 谓词——禁转边对与边 ID 只在所属模态内有效,故必须同模态的图 + 禁转服务。`ModalRuntime` 由接口改为类,`graph` / `wayHighway` 走 getter 惰性构建(转向读写不承担 62.8 万节点 / ~100 万边的构造成本)。错误码:非法 mode 400、未启用多模态 501、派生数据不可用 503。

前端端到端(A 改 `web/src/api-client/` 与 `web/src/map/path-selection.ts`,`web/src/panels/editor/turn-editor.ts` 新增回调,均经用户明确授权):`fetchPath` 新增可选 `mode`,缺省不下发;`path-selection` 新增 `getMode` 选项,路径按**当前显示的交通模态**请求,`'all'`(全量基础路网)不下发 mode;`turn-editor` 新增 `onRestrictionsSaved` 回调,**与勾选预览用的 `onRestrictionChange` 严格区分**——后者每次勾选变动都触发(此时禁转尚未落盘),只有前者表示服务端禁转表已更新,此时才重算路径。真实武汉五路口(节点 1881981626)实测:禁掉路径正在使用的直行边对后路径由 500.18 m / 7 节点变为 751.07 m / 23 节点(绕行),清空禁转后恢复 500.18 m,与初始完全一致——证明"编辑器保存禁转 → 服务端落盘 → 路径立即绕行"闭环成立且无内存分叉。

派生数据已重建:转换点 **2596 → 2930**(subway 659 / bus 1231 / parking 1040),nodeTags 6995 / relations 353,已实测核对一致;`data/derived/` 是 gitignore 生成物,不入库。PR #41(E 前端编辑器)因改动 D 的目录,**A 已请求 D 评审后再合**,D 未批准前不合并。

2026-11-05 A 契约冻结(issue #43,E 提出的路口拾取需求):`NearestIntersectionResponse` 进入 `shared/src/index.ts`,新增 `GET /api/intersections/nearest?lon=&lat=&mode=&maxDistanceM=`。**路口判定口径由服务端负责**:只在当前模态拓扑中判定、邻接节点数 >= 3(排除 degree=2 的道路折点与中间节点、悬挂端点与孤立节点)、按球面距离(haversine)计算、超出阈值一律 404 而不返回"最近但很远"的节点。邻接节点数按**去重后的邻接节点**统计而非按边数统计(一条双向道路在路口贡献两条边但只有一个邻接节点,用边数会把两臂路口误判成交叉路口)。实现用经纬度网格索引(`server/src/api/intersection-index.ts`,挂在 `ModalRuntime` 上惰性构建),实测 20 次查询均值 0.7 ms。真实武汉五路口验证:命中 degree=5、相连 3 条 Way、路名「胜利街/一元路」,道路中段点击 404。

2026-11-05 C分支补充：topology公开buildTransferAttachments/TransferAttachmentIndex/TransferAttachmentReview与computeTransferPenalty，供B直接查询转换点的逐模式节点、路径距离、入出方向及不可用原因。核验路径须显式提供来源记录，未经核验不建立实际连接；罚时显式输入步行距离、速度与等待秒数，不计入PathResult.distance。见docs/plans/c-b-attachments-ready.md。**B 的跨模态搜索、E 的分段渲染、武汉停车楼真实入口核验仍待联合完成，issue #34 保持开放。**

2026-11-03 C后续分支 `feature/transfer-attachments`（未合并）：topology公开matchTransferConnections/inspectTransferEntrances，分别返回逐模式节点匹配证据及原way入口候选，均不自动建立转换边；全部入口候选须核验，边界共享不能证明楼层/屏障可通行。io补识别subway_entrance，武汉标记2930（bus1231/subway659/parking1040），合并后需A重建派生文件；以下2596为旧main基线。真实片段只验证car/walk分段有向可达；A多段路径契约已冻结，B搜索与E页面尚待对接，#34保持开放。交接见docs/plans/c-transfer-connections.md。

A 已把 C 的 Sprint 2 模块挂到 REST 层并用真实武汉数据联调（issue #33）。新增 `server/src/api/modal-runtime.ts`（多模态运行时：按需构建 + LRU）、`server/src/api/modal-routes.ts`（转换点与转向限制路由 + 错误映射）、`server/src/api/index.ts`（api 模块跨目录公开入口，暴露进程内唯一的多模态运行时注册表）。**多模态装载策略采用方案 A 按需懒加载**：武汉实测单模态完整运行时约 1.08 GB 堆、四模态全量约 2.5 GB 堆，故否决启动构建全部四份（方案 B）；重运行时 LRU 容量 1，道路 GeoJSON 序列化结果单独缓存，实测数据与决策见 docs/多模态路网设计.md。**转向边的 ID 只在所属模态内有效**，读写必须带同一个 `mode`（缺省 car），否则服务端返回 400。B 的禁转感知搜索必须与 REST 层共用同一份禁转服务，经 `server/src/api/index.ts` 的 `getActiveModalRuntimeRegistry()` 取用（该依赖方向 A 已预批）；交接说明见 docs/plans/a-sprint2-rest-handoff.md。

错误响应统一为 `{ "error": { "message": "..." } }`（服务端已加统一错误处理与 404 处理，此前为 Fastify 默认形状）。禁转异常映射：400 非法 mode/nodeId/请求体/边对、404 路口不存在、409 恢复失配（带 `restoreIssues`）、422 转向几何无法判定、503 派生数据缺 Sprint2 字段；不留裸 500。C 的模块仍抛普通 Error，A 按消息前缀归类于 `server/src/api/modal-routes.ts` 的 `mapTurnError`（集中一处，C 改抛带 code 错误时只改该函数）。禁转快照落 `data/derived/wuhan-turns.sqlite`，写盘优先、写盘失败不改旧内存，重启按 way 段端点+几何重新匹配恢复（实测 PUT 后重启仍保留）。Node 基线：`node:sqlite` 自 22.13.0 起无需 `--experimental-sqlite`，`engines.node` 收紧为 `>=22.13.0`，不加启动标志、保留上游实验性告警。派生数据已重建（nodeTags 6995 / relations 353 / transferPoints 2596），旧派生文件触发 503 降级而非报错。

契约冻结(issue #34 的 A 决策)：`PathSegment` 进入 `shared/src/index.ts`，`PathResult` 增加**可选**字段 `segments?: PathSegment[]`——跨模态路径分段，段间以 `TransferPoint.id` 相接，段内边 id 只在该段模态内有效，`PathResult.distance` 为各段距离之和（换乘惩罚属时间/成本口径，不计入距离）；单模态路径缺省该字段，现有客户端与测试不受影响。作业二**不做公交线路级建模**：bus 仅表示「公交通行道路」（`motorRoads + busway`），不含线路、站序、班次与停站规则，答辩口径已写入 `docs/多模态路网设计.md`。

C 的 Sprint 2 基础模块已合入 main(PR #31 `0b62afd`、PR #32 `0e8eb9d`，A 评审通过)：`server/src/topology/index.ts` 公开禁转表、转向几何、路口动作枚举、语义分类、OSM 禁转导入、四模态构图与结构诊断；`server/src/io/index.ts` 公开 loader、转换点提取、SQLite 快照存储与 `createTurnRuntime`/`PersistentTurnService`。禁转一律按边对存储与判定，持久化不保存易变 edgeId(按 way 段端点+几何重新匹配)，恢复失配须报告并禁止覆盖旧快照，`setTurns` 磁盘优先、写盘失败不改旧内存。接入示例见 docs/plans/c-sqlite-ready.md。

四模态子图 `buildModalTopology(nodes,ways,mode)` 返回 mode、独立 topology 与准入排除列表，原始道路属性不改变；真实武汉实测 car 990929 / walk 1220177 / bike 1000032 / bus 991582 条有向边，edgeId 不跨模态复用，方向排除另见 topology.issues。转换点 `extractTransferPoints`/`getTransferPoints` 从原始 node/way 提取并按模式查询(真实数据 2596 个：bus 1231 / subway 325 / parking 1040)，way 型位置仅为展示代表点，尚无真实出入口与道路吸附。规则与理由见 docs/多模态路网设计.md。

作业二剩余项：4 个 REST 路由(GET/PUT /api/intersections/:nodeId/turns、GET /api/network?mode=、GET /api/transfer-points?mode=)与派生数据重建由 A 在 issue #33 处理；跨模态换乘连接见 issue #34。

`shared` 的 `NetworkMeta.edgeCount` 更名为 `segmentCount`,定义为预处理产物中的原始相邻节点段数(方向处理前);API `HealthResponse` 与 WS 的 `edgeCount` 为服务端当前装载图的有向边数。
`server/src/topology/index.ts` 公开方向判定、按节点 ID 构边与 `createTopologyReport` 报告入口；兼容 oneway=true/false，未确定方向的道路跳过并在报告列出。本模块不做模态过滤，节点包含有效相邻段的中间节点，边 ID 不保证跨版本稳定。M1 策略确认草稿位于 docs/plans/c-m1-integration-issue-draft.md（未发布、未定案）。
`server/src/graph/`(B):公开入口导出 `Graph`、`dijkstra`、`connectedComponents`、`computeTopologyStats`;`new Graph(topo.nodes, topo.edges)` 直接消费 buildTopology 产物。已接入服务启动组装(2026-10-22)。
契约冻结(issue #4):`PathResult`、`TopologyStats` 已进入 `shared/src/index.ts`,graph 模块改为从 `@gisalgo/shared` 导入,禁止再定义本地副本。度均为有向度(入+出)——M1 口径;无向物理邻接度取舍见 issue #5 留档,变更须契约评审。`degreeDistribution` 为进程内 Map,不可直接 JSON 下发;`PathResult.distance` 不可达为 Infinity,JSON 下发前由 API 层转换。
契约冻结(issue #10):`WeightProfile`、`HighwayStat`、`LengthBucket`、`TopologyMetrics`、`TopologyMetricsSourceTag`、`NetworkStats`、`WeightProfileResponse` 已进入 `shared/src/index.ts`;服务端 weights 与前端 charts/panels 统一从 `@gisalgo/shared` 引用,`web/src/charts/contract.ts` 已删除,禁止再定义本地副本。`TopologyMetrics` 以 `extends Omit<TopologyStats,'degreeDistribution'>` **派生**,`topologySource` 取语义值 `'graph-engine' | 'pending'`。
服务端组装(issue #9/#11/#12):`LoadedNetwork` 现为 `{ meta, nodes, ways, geojson }`,不再预构无向边;`server/src/index.ts` 启动时依次执行 `buildTopology → new Graph → computeTopologyStats → registerRoutes → registerWeightRoutes`。`/api/health` 与 WS 的 `edgeCount` 为有向边数,`wayCount` 为保留道路数;`/api/network` 仍返回原始 GeoJSON。`wayId → highway` 的权威来源为 `TopologyResult.ways`,统计边集为 `topology.edges`;启动日志报告拓扑 issue、方向排除数与缺失映射诊断。
权重统计路由:`registerWeightRoutes` 已注册;`StatsInput.edgeLength` 可注入 `Graph.edgeLength`,使统计里程与路径权重同源;`/api/stats` 按归一化配置缓存(上限 32)并在注册时预热默认配置。拓扑指标由 `computeTopologyStats` 填充(`topologySource='graph-engine'`),Map 度分布经 `toTopologyMetrics()` 转为按度升序数组。
前端集成(issue #13/#15/#16):`web/src/map/` 为 E 的公开入口,`main.ts` 已改用其底图检测/降级与路网图层工厂;统计/权重面板挂载到右侧 `#side-panels`,权重变化去抖后重取统计。Vitest 已包含 `web/**`;Vitest 4 不再支持 `environmentMatchGlobs`,DOM 测试需在文件头写 `// @vitest-environment jsdom` 并在需要时补充 jsdom 依赖。
等级元数据(#12 决策):暂不把限速表并入 shared——配色/线宽是展示参数、限速是算法参数;新增 highway 等级须同时更新 `shared` 的配色/线宽与 `server/src/weights/speed.ts`。
`EdgeWeightFn` 暂不冻结:Sprint 3 权重注入前需 A/D/B 评审扩展(当前签名不含边长,无法实现行程时间权重)。其前置条件为返回值 ≥0 且有限;D 的权重函数在"图内注入"路径上满足(`Graph.addEdge` 已校验端点存在),端点缺失返回的 `Infinity` 仅在图外场景触发。
契约冻结(issue #23):`AttributeCompleteness` 与 `AttributeCompletenessReport` 已进入 `shared/src/index.ts`;`NetworkStats.attributeCompleteness` 为**可选**字段——缺省表示服务端尚未提供该统计,前端不得以 0 冒充完整率,D 实现后由 A 评审收紧为必填。口径为**按 way 统计**(属性来自 way 标签,不是逐条有向边,否则同一 way 的标签会被拆边重复稀释)。
契约冻结(issue #24,作业二):`TravelMode`、`TurnRestrictionType`、`TurnKind`、`TurnRestriction`、`TurnAction`、`IntersectionTurns`、`SetIntersectionTurnsRequest`、`SetIntersectionTurnsResponse`、`TransferPoint` 已进入 `shared/src/index.ts`。转向限制一律按**边对**存储与判定(`viaNode` + `fromEdge` + `toEdge`),`type` 由服务端按几何方位角判定后写入、客户端只提交禁转边对;`TurnAction.turnKind` 与 `angleDelta` **仅供展示**,模糊路口回退显示"目标路名 + 偏角"。多模态接口:`GET /api/network?mode=car|walk|bike|bus` 复用 `RoadFeatureCollection`,`GET /api/transfer-points?mode=` 返回 `TransferPoint[]`;模态过滤规则由 C 在 `server/src/topology/` 定义并写入多模态设计文档。
仓库治理(2026-10-29):新增 `.github/CODEOWNERS`(把 §4.1 的目录所有权映射为 GitHub owner 审批)、`.github/workflows/ci.yml`(typecheck / ESLint / Vitest / 前端构建,PR 与 main 推送均触发)、`.github/pull_request_template.md`(强制填写关联 issue / 改动目录 / 是否涉及契约变更)。`main` 的 ruleset「Restrict mian」已开启 `require_code_owner_review` 与必需状态检查 `check`——改动他人目录的 PR 需该 owner 批准且 CI 通过;A 保留 bypass 权限用于每日集成。注:`web/src/api-client` 实际是单文件,CODEOWNERS 按真实路径映射;`web/src/main.ts`、`web/src/style.css`、`web/index.html` 归 E。
PR #19–#22 合入(2026-10-29):`/api/path` 采用 issue #18 的**方案 A(服务端坐标吸附)**,`PathResponse extends PathResult` 为非破坏性扩展;`web/src/map/path-selection.ts` 提供起终点选路与权重目标变更后重算;`web/src/panels/property/` 道路属性面板组件已入库但**尚未接入主界面**,待 E 在 `web/src/main.ts` 接线;`docs/拓扑验证报告.md` 已提交(注意:99% 的限速来自等级推断,时间类指标均为估算值)。

2026-11-03 数据/持久化修复：预处理保留nodeTags、转换点与所选relations；io公开createTurnRuntime/PersistentTurnService，完成OSM导入、SQLite恢复和磁盘优先更新。report新增structureConflicts疑点；未修改REST/shared/B/E。旧派生文件需重建，细节与实测见docs/plans/c-sqlite-ready.md。脚本变更已由 A 评审通过。

### API 格式

- REST 统一前缀 `/api`,资源名 kebab-case(如 `/api/health`);响应 JSON、字段 camelCase;错误响应 `{ "error": { "message": "..." } }`。
- 当前已注册端点:`GET /api/health`、`GET /api/network`(带 `?mode=car|walk|bike|bus` 返回该模态路网,不带 mode 行为不变)、`GET /api/transfer-points?mode=`、**`GET /api/intersections/nearest?lon=&lat=&mode=&maxDistanceM=`**(坐标反查可编辑路口)、`GET /api/intersections/:nodeId/turns?mode=`、`PUT /api/intersections/:nodeId/turns?mode=`、`GET /api/path`(**带 `?mode=` 时走该模态子图并施加该模态的禁转;缺省走基础图、不施加禁转**)、`GET /api/weights/profile`、`GET /api/stats`、WS `/ws`。转向限制的 `mode` 缺省为 `car`。
- WebSocket 消息信封 `{ "type": "...", "payload": { ... } }`,`type` 为判别字段(见 `WSMessage`)。
- 跨端契约类型(领域模型、API 出入参、WS 消息)统一定义于 `shared/src/index.ts`,前后端禁止重复定义;契约变更须评审。

### 命名规范

- 函数 / 变量:`camelCase`;类型 / 类 / 接口:`PascalCase`(接口不加 `I` 前缀);常量:`UPPER_SNAKE_CASE`;文件名:`kebab-case`。
- 服务端各模块仅经其 `index.ts` 公开入口被跨目录引用,禁止深引用(ESLint 强制)。

### 代码风格

- TypeScript `strict`;ESLint + Prettier:单引号、分号、2 空格缩进、行宽 100。
- 核心算法函数必须有 JSDoc(输入/输出/原理);其余注释从简。

### 前端样式风格

- 深色主题(`color-scheme: dark`):页面底色 `#101418`、正文 `#d7dde6`、点缀金色 `#f2c66d`(标题/高亮);字体 `'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif`,正文 12px、面板标题 14–18px。
- 悬浮层(HUD 面板 / 状态徽标 / 弹窗)统一基调:半透明深色底 + `backdrop-filter` 毛玻璃 + 1px 低透明度边框 + 8–10px 圆角 + 柔和投影(`0 6px 24px rgba(0,0,0,.5)`);道路属性弹窗为 `rgba(0,0,0,.5)` 底 + `blur(8px)`。
- 状态色语义:正常=绿 `#7fd6a0`、异常=红 `#e88`、等待=黄 `#e8c477`。
- 路网按 highway 等级配色/线宽,统一定义于 `shared/src/index.ts`(`HIGHWAY_COLORS` / `HIGHWAY_WIDTHS`),前后端共用,禁止在组件内硬编码。
- 新增 UI 须沿用以上基调(深色、半透明、金色点缀);引入新的主色或亮色底前须在同步区修订本条。

### 当前目录结构

```
GISAlgo/
├── server/   # Fastify 服务(API + WS + 内存路网)
├── web/      # Vite + MapLibre + deck.gl 前端
├── shared/   # 跨端契约类型
├── scripts/  # 数据预处理、dev 编排
├── data/     # 原始数据(大文件不入库);data/derived/ 为生成物
└── docs/     # 立项文档、AI 日志、CHANGELOG、参考资料(docs/ref/)
```

### 技术栈基线

Node 22 LTS · TypeScript · Fastify 5 · Vite · MapLibre GL · deck.gl · Vitest · npm workspaces(详见立项文档 §3)

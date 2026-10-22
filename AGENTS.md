# AGENTS.md

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

> **更新义务**:本节是全员对齐的关键约定。每当 API、契约类型、目录结构或规范发生变化,Agent 必须在完成改动后**自动总结并更新本节**,并在"最后更新"处标注日期。

**最后更新:2026-10-16(D 权重与统计模块合入 PR #8)**

`shared` 的 `NetworkMeta.edgeCount` 更名为 `segmentCount`,定义为预处理产物中的原始相邻节点段数(方向处理前);API `HealthResponse` 与 WS 的 `edgeCount` 含义不变,仍为服务端当前装载图的有向边数。
`server/src/topology/index.ts` 公开方向判定、按节点 ID 构边与 `createTopologyReport` 报告入口；兼容 oneway=true/false，未确定方向的道路跳过并在报告列出。本模块不做模态过滤，节点包含有效相邻段的中间节点，边 ID 不保证跨版本稳定。组装由 A 负责；M1 策略确认草稿位于 docs/plans/c-m1-integration-issue-draft.md（未发布、未定案）。本模块未修改 REST/WS 或 shared 契约。
`server/src/graph/`(B)已随 PR #7 合入:公开入口导出 `Graph`、`dijkstra`、`connectedComponents`、`computeTopologyStats`;`new Graph(topo.nodes, topo.edges)` 直接消费 buildTopology 产物;尚未接入 loader/服务组装。
契约冻结(issue #4):`PathResult`、`TopologyStats` 已进入 `shared/src/index.ts`,graph 模块改为从 `@gisalgo/shared` 导入,禁止再定义本地副本。度均为有向度(入+出)——M1 口径;无向物理邻接度取舍见 issue #5 留档,变更须契约评审。`degreeDistribution` 为进程内 Map,不可直接 JSON 下发;`PathResult.distance` 不可达为 Infinity,JSON 下发前由 API 层转换。`EdgeWeightFn` 暂不冻结:Sprint 3 权重注入前需 A/D/B 评审扩展(当前签名不含边长,无法实现行程时间权重)。
`server/src/weights/`(D)已随 PR #8 提交:公开入口导出 Haversine 距离、等级限速、可注入边权(`createEdgeWeight(context, profile)` 产出符合 `EdgeWeightFn` 的闭包,由 `WeightProfile.metric` 选 distance/time)与网络统计;REST 以 Fastify 插件 `registerWeightRoutes` 提供 `GET /api/weights/profile` 与 `GET /api/stats`(支持 `metric`/`speedFactor`/`speedKmh`),**尚未注册到服务启动流程**,待 A 集成(issue #9)。统计的拓扑指标为显式占位(`topology: null` + `topologySource: 'pending'`),接入后由 `toTopologyMetrics()` 把 `TopologyStats` 的 Map 度分布转为按度升序的数组。
D 侧契约口径:`TopologyStats` 引用 shared,响应体 `TopologyMetrics` 以 `extends Omit<TopologyStats,'degreeDistribution'>` **派生**,禁止平铺副本;`topologySource` 取语义值 `'graph-engine' | 'pending'`,不得用模块路径当枚举值。`WeightProfile`/`NetworkStats`/`HighwayStat`/`LengthBucket` 待 issue #10 冻结进 shared,冻结前前端只读镜像位于 `web/src/charts/contract.ts`(冻结后整体删除)。
边长口径:统计当前用 `weights/geo.ts` 的 `haversineMeters`(原始 float64 坐标),与 `Graph.edgeLength`(Float32 预计算)同源但数值不严格相等(单边最坏 ~0.7 m);A 组装出 Graph 后统计里程应改取 `edgeLength`,切换前以 `docs/plans/d-sprint01-weights-stats.md` §4.2 为口径依据。
`EdgeWeightFn` 前置条件:返回值须 ≥0 且有限。D 的权重函数在"图内注入"路径上满足(`Graph.addEdge` 已校验端点存在),端点缺失返回的 `Infinity` 仅在图外场景(如统计遍历原始边集)触发。

### API 格式

- REST 统一前缀 `/api`,资源名 kebab-case(如 `/api/health`);响应 JSON、字段 camelCase;错误响应 `{ "error": { "message": "..." } }`。
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

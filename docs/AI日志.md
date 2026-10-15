# AI 使用日志

> 依据立项文档 §9:每次使用 AI 工具记录一行,每周五由 Scrum Master 归档。
> 原则:AI 生成的核心算法代码必须**逐行理解并重命名重构**后才可合入 main;**严禁在任何提交中将 AI 加入 contributor**。

| 日期 | 工具 | 用途与 Prompt 摘要 | 采纳程度 | 修改说明 | 理解自评 (1–5) | 关联提交 |
|---|---|---|---|---|---|---|
| 2026-10-12 | Claude | Sprint 0 脚手架:monorepo 初始化、wuhan.json 预处理脚本、Fastify 服务(/api/health、/api/network、WS)、MapLibre+deck.gl 路网渲染前端、CLAUDE/AGENTS 协作规范 | 修改后采纳 | 依赖版本按 Node 22.11 调整(Vite 6);@fastify/websocket 兼容 v10/v11 形态;无网降级改为瓦片可达性预探测;预处理输出保留 OSM 节点 ID | 待组内轮讲后填写 | (提交后填写) |
| 2026-10-14 | Claude | 分析 meta.edgeCount 与服务端 edges.length 的口径分歧,给出双口径/改名等方案;经确认按方案三实施:NetworkMeta.edgeCount 更名 segmentCount 并注明口径,同步 CLAUDE/AGENTS 同步区与 CHANGELOG | 直接采纳 | 仅机械重命名与 JSDoc 口径注释,无逻辑改动;loader/api/web 不受影响(前者透传 meta,后两者用 edges.length) | 待组内轮讲后填写 | [1568922](https://github.com/rrrexfield/Road-Network-Modeling-System/commit/1568922) |
| 2026-10-14 | Codex | C 第一次作业任务准备：检查武汉数据、整理方向规则草案与测试样例设计 | 已批准提交，采纳评价待用户填写 | 统计实际道路与方向标签；记录 Graph 对接、数据范围及缺失节点处理待确认项；未实现算法；经用户确认将准备文档移至 docs/plans/ | 待用户填写 | [359d2fd](https://github.com/rrrexfield/Road-Network-Modeling-System/commit/359d2fd)；准备文档 docs/plans/c-sprint1-topology.md |
| 2026-10-14 | Codex | 按已确认计划实现独立道路方向判定及测试 | 已批准提交，采纳评价待用户填写 | 新增 topology 模块；处理显式方向与 motorway/roundabout 默认，未支持方向返回 unsupported；新增 20 项测试；未接入 Graph 或 loader | 待用户填写 | [359d2fd](https://github.com/rrrexfield/Road-Network-Modeling-System/commit/359d2fd) |
| 2026-10-14 | Codex | 实现桥隧和高架连接关系的独立构边模块 | 已批准提交，采纳评价待用户填写 | 按节点 ID 构边并保留 bridge/tunnel/layer；新增 16 项测试，全仓 41 项通过；类型和 lint 检查通过；武汉数据生成 1,194,218 条边，1 条方向待处理；未接入 Graph 或 loader | 待用户填写 | [359d2fd](https://github.com/rrrexfield/Road-Network-Modeling-System/commit/359d2fd) |
| 2026-10-14 | Codex | rebase 最新 main 并修复 PR #3 的评审意见 | 待用户审核 | 保留 A/C 同步说明及日志，更新 segmentCount；兼容 true/false，提供方向排除报告并明确图范围、路径几何和 ID 生命周期；49 项测试、三包 typecheck、全仓 lint 通过，武汉全量报告重跑一致；M1 策略请求为草稿，未代表 A/B 定案；临时文件改用 D 盘 | 待用户填写 | [PR #3](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/3) |
| 2026-10-14 | WorkBuddy(Claude) | D Sprint 0/1:设计并实现 server/src/weights 权重与统计模块、web/src/charts 图表封装、统计/权重面板与独立预览页,含 49 项单测与交付说明文档 | 修改后采纳 | 依目录所有权把统计路由做成 Fastify 插件而非改 A 的 index.ts;为使面板的模式切换成为真实契约,给 WeightProfile 增加 metric 字段;端点缺失的边在权重与统计中均按"不可通行/跳过"处理而非 0 米;统计的拓扑指标改为 null+pending 显式占位,不以零值冒充;前端离线示例由真实算法在合成路网上生成,脚本不提交;ECharts 采用按需装配 | 待组内轮讲后填写 | [PR #8](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/8) |


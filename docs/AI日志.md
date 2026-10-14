# AI 使用日志

> 依据立项文档 §9:每次使用 AI 工具记录一行,每周五由 Scrum Master 归档。
> 原则:AI 生成的核心算法代码必须**逐行理解并重命名重构**后才可合入 main;**严禁在任何提交中将 AI 加入 contributor**。

| 日期 | 工具 | 用途与 Prompt 摘要 | 采纳程度 | 修改说明 | 理解自评 (1–5) | 关联提交 |
|---|---|---|---|---|---|---|
| 2026-10-12 | Claude | Sprint 0 脚手架:monorepo 初始化、wuhan.json 预处理脚本、Fastify 服务(/api/health、/api/network、WS)、MapLibre+deck.gl 路网渲染前端、CLAUDE/AGENTS 协作规范 | 修改后采纳 | 依赖版本按 Node 22.11 调整(Vite 6);@fastify/websocket 兼容 v10/v11 形态;无网降级改为瓦片可达性预探测;预处理输出保留 OSM 节点 ID | 待组内轮讲后填写 | (提交后填写) |
| 2026-10-14 | Claude | 分析 meta.edgeCount 与服务端 edges.length 的口径分歧,给出双口径/改名等方案;经确认按方案三实施:NetworkMeta.edgeCount 更名 segmentCount 并注明口径,同步 CLAUDE/AGENTS 同步区与 CHANGELOG | 直接采纳 | 仅机械重命名与 JSDoc 口径注释,无逻辑改动;loader/api/web 不受影响(前者透传 meta,后两者用 edges.length) | 待组内轮讲后填写 | (提交后填写) |

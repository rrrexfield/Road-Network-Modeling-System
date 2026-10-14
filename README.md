# GISAlgo · 路网建模与拓扑构建系统(G2 组)

面向 GIS 算法课程的 B/S 架构路网建模系统:Node.js 服务端持有路网图模型与全部算法,浏览器端负责可视化与交互编辑。

当前进度:**Sprint 0(立项与地基)已完成**——"数据 → 服务端 → 浏览器渲染"最小链路已跑通并验收。

Sprint 1 的 C 拓扑基础模块已实现：`server/src/topology/index.ts` 提供道路方向判定和独立构边入口，按原始节点 ID 连接道路并保留桥隧、层级属性。模块尚未接入当前数据装载流程或 B 的 Graph，网页仍使用 Sprint 0 链路。方向与构边新增 36 项测试；规则、异常策略和武汉全量检查见 `docs/plans/c-sprint1-topology.md`。

## 技术栈

| 层 | 选型 |
|---|---|
| 服务端 | Node.js 22 LTS · TypeScript · Fastify 5 · WebSocket(@fastify/websocket) |
| 前端 | Vite · TypeScript · MapLibre GL JS · deck.gl(PathLayer) |
| 契约 | npm workspaces monorepo,跨端类型统一定义于 `shared/src/index.ts` |
| 质量 | Vitest · ESLint · Prettier |

## 目录结构

```
GISAlgo/
├── server/              # Fastify 服务
│   └── src/
│       ├── api/         # REST + WS 路由
│       ├── io/          # 派生数据装载(内存 nodes/edges/GeoJSON)
│       ├── topology/    # [C] 独立道路方向与构边模块(尚未接入 loader/Graph)
│       └── index.ts     # 组装与启动(端口 3000)
├── web/                 # Vite 前端(端口 5173,代理 /api、/ws 到 3000)
│   └── src/             # main.ts(地图与图层)/ api-client.ts(REST+WS 客户端)
├── shared/              # 跨端契约:领域模型 / API 出入参 / WS 消息 / 路网配色
├── scripts/             # prepare-data.ts 数据预处理 · dev.mjs 启动编排
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

打开后应看到:深色底图上的武汉路网(按 highway 等级着色);点击道路弹出属性;左下角为 API / WS / 底图状态徽标;悬停可点选道路时光标变为 pointer。

> 离线环境:底图(OpenFreeMap Dark,免 key)加载失败会自动降级为纯色背景,路网渲染与点选不受影响。

## 数据管线

```
data/wuhan.json (教师备份,162MB,不入库——经教师/组内渠道获取后置于 data/)
   │  npm run prepare:data
   ▼
data/derived/wuhan-roads.json (~30MB, 不入库)
   │  server/src/io/loader.ts 启动时载入
   ▼
内存路网:69,382 条道路 / 627,900 节点 / 673,120 条边
```

- 源数据 `data/wuhan.json` 与 `data/hubei.json` 已从 Git 历史彻底移除,不随仓库分发;克隆后需自行获取 `wuhan.json` 放入 `data/`,否则预处理无法执行(可直接向组内索取现成的 `data/derived/wuhan-roads.json` 放到同路径使用);
- 预处理只保留带 `highway` 标签的 way 及其关联节点,保留 OSM 节点 ID(`nds`),供 Sprint 1 图引擎构建拓扑;
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
| GET | `/api/health` | 健康检查:节点 / 边 / way 计数与运行时长 |
| GET | `/api/network` | 全量路网 GeoJSON(每 way 一条 LineString,属性含 id/name/highway/tags) |
| WS | `/ws` | 消息信封 `{ type, payload }`;连接即推 `hello`,支持 `ping`/`pong` |

错误响应统一为 `{ "error": { "message": "..." } }`;契约类型见 `shared/src/index.ts`,前后端禁止重复定义。

## 开发约定

- **协作规范(必读)**:根目录 `CLAUDE.md` 与 `AGENTS.md`(内容一致)——角色门禁、Git 分支/提交规范、API 与命名约定、前端样式基线;
- 里程碑与 Sprint 计划:`docs/立项文档.md`;变更记录:`docs/CHANGELOG.md`;AI 使用日志:`docs/AI日志.md`(课程硬性要求);
- 目录所有权:见立项文档 §4.1,跨目录只允许引用对方公开入口;
- 核心算法(图引擎 `server/src/graph/`)自 Sprint 1 起实现,Vitest 测试全绿是合入门槛。

## 已知注意点

- Node 22.11 搭配 Vite 6;maplibre-gl v6 需在 `vite.config.ts` 中排除依赖预构建(`optimizeDeps.exclude`),已配置;
- Carto 瓦片自 2025 年起需要 API key(带水印),底图已改用 OpenFreeMap Dark;
- 端口占用:服务端 3000、前端 5173,启动前确保空闲。

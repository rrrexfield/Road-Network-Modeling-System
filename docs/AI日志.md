# AI 使用日志













> 依据立项文档 §9:每次使用 AI 工具记录一行,每周五由 Scrum Master 归档。
> 原则:AI 生成的核心算法代码必须**逐行理解并重命名重构**后才可合入 main;**严禁在任何提交中将 AI 加入 contributor**。

| 日期 | 工具 | 用途与 Prompt 摘要 | 采纳程度 | 修改说明 | 理解自评 (1–5) | 关联提交 |
|---|---|---|---|---|---|---|
| 2026-11-03 | Codex | 用户审核通过后准备发布C侧对接 | 已批准对接稿 | 发布前核对发现更新测试数时误改了公交数和main短哈希，按实测恢复bus1231及6852316；未改代码与测试结果；准备推送功能分支并在#34附代码链接联系A/B/E，不直推main | 待用户填写 | 本次文档修正提交；功能0b3ab58 |
| 2026-11-03 | Codex | 完成本批C入口证据与真实片段测试，准备成员交接 | 待用户审核 | 补334个地铁出入口，武汉2930标记；100米匹配3050点-模式组合，561区域入口候选仍需核验；保留35节点/5way片段，用既有Graph/Dijkstra验证24米汽车+196米步行分段及断路负例，不宣称实景换乘或跨模态搜索完成；修正近等距顺序依赖；232测试、全仓typecheck/lint/build通过（构建体积警告）；缺少的既有echarts依赖在D盘隔离安装并经本地node_modules目录连接使用，未改依赖清单/锁文件；同步文档，对接草稿未发送 | 待用户填写 | 本次功能提交，feature/transfer-attachments |
| 2026-11-03 | Codex | Issue #34 区域转换点入口证据核查 | 待用户审核 | 新增显式入口/共享边界候选分析，不用区域中心补造连接；武汉1040设施中213有候选、561候选节点、12明确入口、126多模式共享，仍需人工及搜索核验；全仓228项通过，server类型与topology lint通过，未发布 | 待用户填写 | feature/transfer-attachments，未提交 |
| 2026-11-03 | Codex | 合并后小修与Issue #34续作恢复 | 待用户审核 | 同步main至6852316；A已修同步日期；清理重复条件判断并补步行例外测试；在独立分支恢复候选匹配而不覆盖A改动，原stash保留；补充真实换乘连接计划，未发布GitHub内容 | 待用户填写 | feature/transfer-attachments，未提交 |
| 2026-11-03 | Codex | 核对截图缺陷并交付SQLite运行时 | 待用户审核 | 核实main缺失POI/relations/OSM导入和结构诊断；修复预处理与loader、加入source=osm解析、报告结构疑点；提供磁盘优先更新与恢复门面；全仓212测试及shared/server类型、全仓lint通过；武汉汽车72条禁转保存恢复通过，32条关系诊断；截图5节点未按当前诊断规则复现，实际26疑点；脚本需A评审，未改REST | 待用户填写 | fix/sprint2-data-persistence；待补提交 |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 同步 main 至 39e1531，核对 Issue #27–#29 与冻结契约，整理 C 的 Sprint 2 实施草案（docs/plans/c-sprint2-topology.md）。仅规划，尚未实现或测试 Sprint 2 功能；采纳程度与理解自评待用户填写，关联提交待提交后补充。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 按 Sprint 2 计划实现禁转稀疏表第一步，支持边对查询、原子覆盖、去重与清空，新增 5 项测试通过。尚未实现转向几何、持久化与多模态，未提交；采纳评价与理解自评待用户填写。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 继续实现转向几何展示计算，右正左负，支持五类显示和零长度/非法几何无法判定；新增 10 项测试，与稀疏表共 15 项通过，server 类型检查与 topology lint 通过。阈值为项目显示草案，未接入转向枚举、搜索或前端，未提交；理解自评待用户填写。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 实现 IntersectionTurnIndex，按路口索引枚举全部入/出边组合，连接几何和手动禁转状态，新增 7 项测试。topology 共 66 项测试通过，server 类型检查及 topology lint 通过；五路口目前为合成数据，OSM 禁转来源、限制类型归并与真实五路口仍未完成。未提交或推送，理解自评待用户填写。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 上述路口枚举完成后全仓回归 163 项通过；沙箱内既有 HTTP 测试因本地连接权限失败，沙箱外重跑通过，无相应代码修改。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 从武汉原始数据筛选五分支节点，保存小型固定夹具与来源哈希，新增2项测试通过，server类型检查和io/topology lint通过。候选为一元路/胜利街节点1881981626，真实单行规则下12个转向；人工禁左仅为演示，尚未人工地图核验或与B/E联调。未提交或推送，理解自评待用户填写。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 实现普通禁转类型与only_straight_on按入口归并，模糊禁转不强制分类、返回unclassified且不改变稀疏禁转表。新增6项测试通过，server类型检查及topology lint通过；未提交、未推送、未持久化，理解自评待用户填写。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 验证Node内置SQLite后实现手动禁转快照持久化与snapshot导出，使用道路有向段/节点/几何恢复当前edgeID。7项专项测试通过，server类型检查与io/topology lint通过；不自动接入API或保证内存磁盘业务事务。数据库测试在D盘且完成后清理；未提交推送，采纳与理解自评待用户填写。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 持久化后全仓178项测试通过，shared/server类型检查通过；web类型检查因本地未安装既有echarts依赖失败，未安装依赖或修改前端。该限制不属于本次新增模块测试失败。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 实现四模态独立构图、准入矩阵与模式方向例外，保留原始属性并输出排除原因。18项专项测试通过，server类型检查和topology lint通过；武汉四模式边数car990929/walk1220177/bike1000032/bus991582，端点缺失均为0。转换点、API、跨模态路径尚未完成；未提交推送，理解自评待用户填写。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 四模态模块完成后全仓回归196项测试通过；规则默认值仍待A/B评审，未声称导航或跨模态路径已验收。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | Sprint 2 开发与验证 | 待用户填写 | 实现原始OSM node/way转换点标记提取与按模式查询，保留来源与代表点方法；武汉全量2,596条结果、43条权限排除。新增5项测试，全仓201项通过，server类型检查和io lint通过；不代表实体去重、真实出入口或换乘路径完成。未提交推送，理解自评待用户填写。 | 待用户填写 | 未提交；feature/turn-restrictions |
| 2026-10-30 | Codex | 整理首批模块接入说明与PR草稿 | 待用户审核 | 明确A/B/E接入、未完成项和验证限制，未发布GitHub内容 | 待用户填写 | 未提交；docs/plans/c-sprint2-handoff.md |
| 2026-10-12 | Claude | Sprint 0 脚手架:monorepo 初始化、wuhan.json 预处理脚本、Fastify 服务(/api/health、/api/network、WS)、MapLibre+deck.gl 路网渲染前端、CLAUDE/AGENTS 协作规范 | 修改后采纳 | 依赖版本按 Node 22.11 调整(Vite 6);@fastify/websocket 兼容 v10/v11 形态;无网降级改为瓦片可达性预探测;预处理输出保留 OSM 节点 ID | 待组内轮讲后填写 | (提交后填写) |
| 2026-10-14 | Claude | 分析 meta.edgeCount 与服务端 edges.length 的口径分歧,给出双口径/改名等方案;经确认按方案三实施:NetworkMeta.edgeCount 更名 segmentCount 并注明口径,同步 CLAUDE/AGENTS 同步区与 CHANGELOG | 直接采纳 | 仅机械重命名与 JSDoc 口径注释,无逻辑改动;loader/api/web 不受影响(前者透传 meta,后两者用 edges.length) | 待组内轮讲后填写 | [1568922](https://github.com/rrrexfield/Road-Network-Modeling-System/commit/1568922) |
| 2026-10-14 | Codex | C 第一次作业任务准备：检查武汉数据、整理方向规则草案与测试样例设计 | 已批准提交，采纳评价待用户填写 | 统计实际道路与方向标签；记录 Graph 对接、数据范围及缺失节点处理待确认项；未实现算法；经用户确认将准备文档移至 docs/plans/ | 待用户填写 | [359d2fd](https://github.com/rrrexfield/Road-Network-Modeling-System/commit/359d2fd)；准备文档 docs/plans/c-sprint1-topology.md |
| 2026-10-14 | Codex | 按已确认计划实现独立道路方向判定及测试 | 已批准提交，采纳评价待用户填写 | 新增 topology 模块；处理显式方向与 motorway/roundabout 默认，未支持方向返回 unsupported；新增 20 项测试；未接入 Graph 或 loader | 待用户填写 | [359d2fd](https://github.com/rrrexfield/Road-Network-Modeling-System/commit/359d2fd) |
| 2026-10-14 | Codex | 实现桥隧和高架连接关系的独立构边模块 | 已批准提交，采纳评价待用户填写 | 按节点 ID 构边并保留 bridge/tunnel/layer；新增 16 项测试，全仓 41 项通过；类型和 lint 检查通过；武汉数据生成 1,194,218 条边，1 条方向待处理；未接入 Graph 或 loader | 待用户填写 | [359d2fd](https://github.com/rrrexfield/Road-Network-Modeling-System/commit/359d2fd) |
| 2026-10-14 | Codex | rebase 最新 main 并修复 PR #3 的评审意见 | 待用户审核 | 保留 A/C 同步说明及日志，更新 segmentCount；兼容 true/false，提供方向排除报告并明确图范围、路径几何和 ID 生命周期；49 项测试、三包 typecheck、全仓 lint 通过，武汉全量报告重跑一致；M1 策略请求为草稿，未代表 A/B 定案；临时文件改用 D 盘 | 待用户填写 | [PR #3](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/3) |
| 2026-10-14 | WorkBuddy(Claude) | D Sprint 0/1:设计并实现 server/src/weights 权重与统计模块、web/src/charts 图表封装、统计/权重面板与独立预览页,含 49 项单测与交付说明文档 | 修改后采纳 | 依目录所有权把统计路由做成 Fastify 插件而非改 A 的 index.ts;为使面板的模式切换成为真实契约,给 WeightProfile 增加 metric 字段;端点缺失的边在权重与统计中均按"不可通行/跳过"处理而非 0 米;统计的拓扑指标改为 null+pending 显式占位,不以零值冒充;前端离线示例由真实算法在合成路网上生成,脚本不提交;ECharts 采用按需装配 | 待组内轮讲后填写 | [PR #8](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/8) |

| 2026-10-16 | WorkBuddy(Claude) | D 按 PR #8 评审意见 rebase 最新 main 并适配 PR #14:删除 TopologyMetricsSource 镜像改引 shared 的 TopologyStats、TopologyMetrics 改为派生、topologySource 改语义名、补 EdgeWeightFn 前置条件测试、修复前端 metric 未透传 | 修改后采纳 | rebase 三个文档冲突均为追加型,保留双方;拓扑类型改为派生而非平铺,避免与 shared 字段漂移;topologySource 不再把模块路径当枚举值;边长口径(Float32 量化差异)以文档留档而非新增契约字段,避免未评审扩大契约面;前端 metric 未透传属自查发现,一并修复 | 待组内轮讲后填写 | [PR #8](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/8) |
| 2026-10-16 | Codex | E 开发环境搭建：排查本机 PATH 上只有工具自带 Node 运行时（无 npm），安装 Node 24.22 LTS + npm 11.19 并加入用户 PATH；诊断 github.com:443 被阻断，改用 ssh.github.com:443 通道 | 直接采纳 | 采用免安装 ZIP 版装入用户目录，不写系统目录；SSH 密钥由本人生成并自行在 GitHub 登记；PATH 仅追加用户级条目，未改系统 PATH | 5 | 本机配置，无仓库提交 |
| 2026-10-22 | Codex | E 首次 PR：把 `main.ts` 中的底图可用性检测、降级样式与路网图层创建抽成 `web/src/map/` 模块 | 修改后采纳 | 3 个文件 72 行；行为与原实现一致，仅做模块化搬移，未改动任何既有文件；发现 `buildStyle(true)` 的 Carto 分支为死代码，在 PR 描述中说明并交 A 决定是否删除 | 4 | PR #15 |
| 2026-10-22 | Codex | E 第二次 PR：道路属性面板（纯函数视图模型 + DOM 渲染）；同时提出 `/api/path` 接口需求 | 修改后采纳 | 把视图模型与 DOM 解耦，使单测可在 Node 环境运行、避免为 DOM 测试引入 jsdom；渲染改用 `textContent` 替代 `innerHTML`；标签从截断 6 个改为全部展示 | 4 | PR #19 / Issue #18 |
| 2026-10-22 | Claude | 处理 Sprint 1 集成 issue #9–#13/#16 与 PR #15:权统契约冻结、服务端 topology→graph→stats 组装与权重统计路由注册、统计缓存与 edgeLength 注入、前端地图模块接线与统计/权重面板挂载、放开 web 测试 | 修改后采纳 | 经用户授权跨目录修改 loader/api/main.ts 等;C 确认 wayId→highway 以 TopologyResult.ways 为权威来源,统计范围改用 topology.edges;健康/WS 边数改为有向口径;为保留权重面板输入焦点,统计刷新不重建等级行,徽标改在 syncControls 更新;统计缓存上限 32 并预热;Vitest 4 不再支持 environmentMatchGlobs,暂不引入 jsdom | 待组内轮讲后填写 | [PR #17](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/17) |
| 2026-10-29 | MiniMax Code | A 组流程处理:评审并合并 PR #19–#22;冻结作业二契约(issue #23 属性完整率、issue #24 转向限制与多模态)到 shared;补 .github/CODEOWNERS、CI 工作流与 PR 模板;main 的 ruleset 开启 code owner 审批与必需状态检查;关闭 issue #18/#24,#23 转 D,另建 B/C/E 三条作业二交接 issue(#27/#28/#29) | 修改后采纳 | 本轮按用户确认只做流程与契约,不写作业二功能代码,严格守住目录所有权;`attributeCompleteness` 设计为可选字段以免打断 D 现有编译,缺省语义("未提供,不得以 0 冒充")写进契约注释;转向限制的 `type` 改由服务端按几何判定,避免前后端各写一套方位角逻辑;CODEOWNERS 按仓库实际路径映射(`web/src/api-client.ts` 实为单文件,`web/src/main.ts`/`style.css`/`index.html` 归 E);ruleset 的 `required_status_checks` 用数组 schema,首次按旧式 `contexts` 提交被 API 422 拒绝后改正;PR #19 与 main 的 CHANGELOG 冲突由 A 解决,双方条目均保留 | 待组内轮讲后填写 | [PR #25](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/25) / [PR #26](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/26) / issue #23 #24 #27 #28 #29 |
| 2026-10-29 | MiniMax Code | 环境排查:github.com:443 间歇性 TLS 握手失败(DNS 解析到 198.18.x.x 代理 fake-IP) | 直接采纳 | 定位本地代理 127.0.0.1:7897,gh/git 命令统一带 HTTP_PROXY/HTTPS_PROXY 重试;在本仓库 .git/config 设置 http.proxy/https.proxy(仅本机生效,不入库),未改动任何仓库代码或全局配置 | 5 | 本机配置,无仓库提交 |
| 2026-11-03 | Codex | 首批 Sprint 2 模块提交前复查 | 待用户审核 | 核对Issue #27无新增回复、无开放PR；补齐README/CHANGELOG；全仓201项测试通过，shared/server类型检查、全仓lint和相关格式检查结果据实记录；未提交推送 | 待用户填写 | feature/turn-restrictions，未提交 |
| 2026-11-03 | MiniMax Code | A 评审并合并 PR #31/#32(作业二转向限制与多模态基础模块)：逐文件通读实现与测试，用真实 data/wuhan.json 独立复核数据口径与端到端链路，关闭 issue #27 并给 #28/#29 补交接说明，另建 #33(REST 挂载与派生数据重建)、#34(跨模态换乘连接)；同步协作同步区口径 | 修改后采纳 | 复核结论与 PR 声明完全一致(relations 353、nodeTags 6995、转换点 2596、car 990929 边、OSM 禁转 72 对、结构疑点 26)，本地 212 项测试、三包 typecheck、全仓 lint 与两次合并的 CI 全绿；记录 3 处非阻断问题(getTurns 几何退化抛错需 REST 层映射、importOsmRestrictions 条件判断分支重复、同步区日期与正文不一致)；PR base 切换不触发工作流，推空提交触发 CI；未改动任何 B/C/E 的功能代码，评审产物写在 PR 评论与 issue 评论 | 待组内轮讲后填写 | [PR #31](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/31) / [PR #32](https://github.com/rrrexfield/Road-Network-Modeling-System/pull/32) / issue #27 #28 #29 #33 #34 |

| 2026-10-30 | MiniMax Code | 答复数据字段咨询(road_nodes/edges 字段名与类型、坐标系、单位、单双向表示、几何格式);先误按"生成 CSV 样例"处理,经用户指出"没有 CSV 就说明没有 CSV"后撤回全部生成物,改为基于现有 data/derived/wuhan-roads.json 实测作答 | 待用户填写 | 撤回自建的 6 个 CSV/脚本文件(移入回收站);以只读脚本实测 wuhan-roads.json 顶层结构、节点/way 字段、tags 键频次、方向判定与段数换算,脚本用完即删;全程未改动任何源码;发现口径要点:nodes 数组为 [id,lat,lon] 而 meta.bbox 为 [minLon,minLat,maxLon,maxLat],两者经纬顺序相反;文件内无 edge/边长/速度/时间字段,边为运行时由 buildTopology 生成 | 5 | 本地产物,无仓库提交 |

| 2026-11-03 | MiniMax Code | 答复"路网数据有无高程、如何区分高架与地面"问题:实测 wuhan-roads.json 的高程与结构标签分布,核查 build-topology 及 C 组计划文档中的桥隧处理约定 | 待用户填写 | 只读分析,未改动任何源码与数据;确认无高程字段(ele 仅 2 个 way,height 15 个 way 为桥下净高),高架靠 bridge/tunnel/layer 标签区分而非几何高程;实测 16 对跨层立交节点坐标重合但 ID 不同(按 ID 构边不误连)、10,960 个节点跨层共用 ID(真连接,不应按 layer 拆);发现 5 个节点同时挂 bridge 与 tunnel 的结构属性矛盾,当前模块不诊断 | 5 | 无仓库提交,仅本轮问答 |

| 2026-11-03 | MiniMax Code | 追问"这些数据缺陷是否原始 wuhan.json 就带有":逐 way 比对原始与派生的 tags/nds/name,核对高程与结构标签计数,并盘点预处理丢弃的内容 | 待用户填写 | 只读比对,未改动源码与数据;结论:预处理对 way 的标签与节点序列完全无损(69,382 个 way 逐个比对 0 差异、原始带 highway 的 way 数与派生一致),故无高程、bridge/layer 缺失、5 个结构矛盾节点、1,633 个 nd 重复 way、272 处坐标重合均为原始 OSM 数据自带;同时发现自造缺口:预处理丢弃了 6,995 个路节点的 tags 与全部 1,471 条 relations(含 102 条 restriction、45 条 public_transport),后者正是作业二转向限制 OSM 导入与公交模态的数据来源 | 5 | 无仓库提交,仅本轮问答 |

| 2026-11-03 | MiniMax Code | 答复"wuhan-roads.json 与 wuhan.json 有什么区别":逐项比对两文件的顶层键、规模、元素结构与 POI 节点留存情况 | 待用户填写 | 只读比对,未改动源码与数据;结论:派生文件是原始 OSM 备份的路网子集(体积 22.8%、way 无损保留 69,382 条),丢弃了 1,296,703 个非路节点(含 45,056 个带 tags 的 POI 节点整体消失)、6,995 个路节点的 tags、以及全部 1,471 条 relations;实测 POI 语义 100% 丢失(地铁站 334→坐标残留但标签全无、railway=station/tram_stop 各 342/118 个整体消失),而 relations 中的 102 条 restriction 与 45 条 public_transport 正是作业二转向限制与公交模态的现成数据源 | 5 | 无仓库提交,仅本轮问答 |

| 2026-11-04 | MiniMax Code | 角色 A 执行 issue #33:挂载作业二四个 REST 路由、重建派生数据、定多模态装载策略、落 Node 基线,并补前端封装与交接文档 | 待用户填写 | 在 A 名下目录内新增 server/src/api/modal-runtime.ts、modal-routes.ts、index.ts 与 modal-routes.test.ts,改 routes.ts(/api/network 的 mode 分支 + 统一错误形状)、server/src/index.ts(运行时接线)、web/src/api-client.ts(四个封装)、package.json(engines ≥22.13.0);实测四模态内存后定"方案 A 懒加载 + LRU 容量 1"并否决启动全量构建;重建派生数据(nodeTags 6995/relations 353/transferPoints 2596);真实数据冒烟:car 转换点 928、walk 2596、五路口 12 个转向、PUT 后重启仍保留;全仓 228 项测试、typecheck、lint 全绿;C/B/E 目录未改动 | 待用户填写 | PR #36(已合 main 3366c7c) |
| 2026-11-04 | MiniMax Code | 角色 A 拍板 issue #34 的两个契约点:跨模态路径是否扩展 PathResult、公交模态语义边界 | 待用户填写 | 在 shared/src/index.ts 冻结 PathSegment 并给 PathResult 增加可选字段 segments?(非破坏性,单模态路径缺省);段间用已冻结的 TransferPoint.id 表达换乘,段内边 id 只在该段模态内有效,distance 为各段距离之和(换乘惩罚不计入距离);未采纳"前端多次调用拼接";作业二不做公交线路级建模,bus 仅表示公交通行道路,答辩口径写入 docs/多模态路网设计.md;同步区与 CHANGELOG 已更新 | 待用户填写 | 待提交 |

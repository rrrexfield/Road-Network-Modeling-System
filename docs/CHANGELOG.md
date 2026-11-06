# 更新日志

格式参考 Keep a Changelog;版本对应课程里程碑。

## [Unreleased]

### Changed(Sprint 2 · A 接线模态权重与属性完整率,issue #47 / #23)

- **`/api/path` 的 mode 分支改用模态权重**(issue #47):显式给 `mode` 时走 `createModeEdgeWeight`,时间口径按该模态的速度表换算(步行 4 km/h,不再是汽车 fallback 30 km/h),distance 口径与模态无关(两模态共用同一 Haversine 里程);**缺省(不带 mode)仍走基础图 + 汽车限速表,行为与作业一完全一致**。
- **`/api/stats` 启用属性完整率**(issue #23):`registerWeightRoutes` 的 network 入参补 `ways: topology.ways`(**全量 69,382 条 way**,不按参与构边的 way 过滤,与拓扑验证报告口径一致)。
- **契约收紧(A 决策,兑现 issue #23 的承诺)**:`NetworkStats.attributeCompleteness` 由可选改为**必填**,`StatsInput.ways` 同步改为必填。理由:服务端已恒定提供该统计,再保留"缺省=服务端尚未提供"的状态只会让前端长期挂着待接入分支,并留下"以 0 冒充完整率"的口子。配套改动:`web/src/panels/stats/sample.ts` 示例数据补齐该字段;`stats-panel.ts` 保留运行期兜底(旧服务端缺字段时显示占位),类型上以 `AttributeCompletenessReport | undefined` 局部变量承接。
- 新增 4 项测试:显式 mode 的时间口径按模态差异(步行 > 汽车 5 倍)、distance 口径两模态一致、缺省 mode 与 car 模态时间一致、`/api/stats` 下发属性完整率。全仓 320 项通过,三包 typecheck 与全仓 ESLint 全绿。

### Added(Sprint 2 · D 属性完整率与多模态权重,issue #23 / #47)

- `server/src/weights/stats.ts`:`StatsInput` 新增可选 `ways`(way 标签表,`StatWay = { highway, tags }`,与 `TopologyResult.ways` 的 `WayProperties` 结构兼容);新增 `computeAttributeCompleteness`,按 issue #23 冻结口径**按 way 统计** name/maxspeed/lanes/surface/oneway 的 filled/total/ratio(0–1),只计原始标注、不把按等级推断的限速算进 filled;空串/纯空白视为未填写,空表返回 total=0 不除零。`computeNetworkStats` 在提供 ways 时填充 `attributeCompleteness`,未提供时保持缺省(契约语义:服务端尚未提供该统计)。
- `web/src/panels/stats/`:新增「属性完整性」横向条形图(0–100%);字段缺省时显示「待接入」占位覆盖层,不以 0% 冒充完整率。
- 新增 `server/src/weights/mode-weight.ts`(Sprint 2 多模态权重):`createModeEdgeWeight(context, mode, profile)` 模态边权——car 委托既有 `createEdgeWeight`(零行为变化),walk/bike/bus 用模态速度表;time 口径按模态换算(修复 `/api/path?mode=walk` 用汽车 fallback 30 km/h 算步行时间的口径失真),distance 口径与模态无关(跨模态共用同一 Haversine 里程);`effectiveModeSpeedKmh` 与汽车模型保持同一覆盖合成顺序;`transferPenaltySeconds` 换乘罚时为**占位值**(地铁 5 分/公交 3 分/停车 5 分),标定依赖 issue #34 的核验换乘连接。设计说明与占位值声明见 `docs/plans/d-sprint2-weights-stats.md`。
- 新增 22 项测试(模态速度表、时间换算、覆盖合成顺序、car 模型逐边一致、罚时正有限、完整率口径与缺省语义),全仓 289 项通过;三包 typecheck、全仓 ESLint、Prettier 全绿。
- 评审 PR #41(E 改动 D 目录 3 个展示文件)并批准:占比环形图与总通行时间 KPI 的删除不影响作业三数据能力,契约字段保留;`/api/path` 模态权重注入与统计 ways 接线请 A 处理(issue #47)。

### Added(Sprint 2 · A 路口就近查询,issue #43)

- 契约冻结:`NearestIntersectionResponse` 进入 `shared/src/index.ts`,含 `nodeId`、`position`、`distanceMeters`、`degree`、`connectedWayIds`、`roadNames` 六个字段。
- 新增 `GET /api/intersections/nearest?lon=&lat=&mode=&maxDistanceM=`:把点击经纬度映射为可编辑路口。**路口判定口径**(服务端负责,前端不得自行推断):只在当前模态拓扑中判定、邻接节点数 >= 3(排除 degree=2 的道路折点与中间节点、悬挂端点与孤立节点)、按球面距离(haversine)计算、**超出阈值一律 404 而不返回"最近但很远"的节点**。
- 邻接节点数按**去重后的邻接节点**统计而非按边数统计——一条双向道路在路口贡献入边与出边两条边但只有一个邻接节点,用边数会把两臂路口误判成交叉路口。
- 新增 `server/src/api/intersection-index.ts`:经纬度网格索引把候选集缩小到点击位置附近(模态拓扑有 62.8 万节点,线性扫描不可接受)。索引挂在 `ModalRuntime` 上惰性构建,与既有的 graph / wayHighway 惰性策略一致。
- 错误映射:非法 mode / 非法经纬度 / 非法半径返回 400,派生数据不可用返回 503,阈值内无路口返回 404。
- 前端 `api-client` 新增 `fetchNearestIntersection`:阈值内无路口返回 `null`(点到了普通道路是正常结果,不是接口故障),接口故障才抛错。
- **真实数据验证**(武汉五路口 1881981626):命中 `degree=5`、相连 3 条 Way、真实路名「胜利街 / 一元路」;用返回的 nodeId 查转向得到 12 个转向动作且位置一致;道路中段点击返回 404;连续 20 次查询均值 0.7 ms。

### Added(Sprint 2 · A 前端接入模态,禁转端到端影响路径,issue #38)

- `web/src/api-client.ts` 的 `fetchPath` 新增可选 `mode` 参数,缺省不下发(服务端走基础图、不施加禁转,与作业一一致),显式给模态时随查询下发,供服务端按该模态的禁转表判定转向。
- `web/src/map/path-selection.ts` 新增 `getMode` 选项,路径按**当前显示的交通模态**请求;`'all'`(全量基础路网)不下发 mode,选定具体模态时下发该模态。状态栏标注模态,便于确认路径是在哪套路网与禁转规则下算出的。
- `web/src/panels/editor/turn-editor.ts` 新增 `onRestrictionsSaved` 回调,与既有 `onRestrictionChange` 区分开:后者在勾选预览等每次变动时触发(此时禁转尚未落盘),只有前者表示服务端禁转表已更新,此时重算路径才能得到真正绕开禁转的结果。
- 新增 `web/src/map/path-mode.ts`(显示模态 → 请求 mode 的纯映射)与两项测试文件,覆盖 mode 缺省不下发、指定模态下发、全量与未就绪态的处理。
- **真实数据验证**:武汉五路口(节点 1881981626)实测——禁掉路径正在使用的直行边对后,`/api/path?mode=car` 路径由 500.18 m / 7 节点变为 751.07 m / 23 节点(被迫绕行),清空禁转后恢复 500.18 m,与初始完全一致。证明"编辑器保存禁转 → 服务端落盘 → 路径立即绕行"闭环成立且无内存分叉。

### Added(2026-11-05 · C给B的接驳表)

- topology公开buildTransferAttachments与相关类型，返回逐模式可用性、节点、实际接驳路径长度、入出方向和核验记录；未经核验、超距/失配/无入口证据均不可用。
- computeTransferPenalty显式接收步行距离、速度和等待秒数，不混入距离。同步main 5c0d194的REST及PathSegment约定；259项测试、完整typecheck/lint/build通过。真实停车楼入口核验仍待完成，#34不关闭。

### Added(Sprint 2 · 接驳证据，feature/transfer-attachments 未合并)

- 补识别地铁出入口subway_entrance，武汉标记由2596增至2930，仍属walk，旧派生文件须重建。
- 公开逐模式的共享节点/近邻候选匹配及原way入口证据核查，报告距离、并列、权限、屏障和失配，不自动生成转换边。
- 武汉35节点/5条way固定片段验证car/walk分段有向可达与断路负例，停车共享边界仍需核验，未完成跨模态搜索。
- 清理OSM导入重复条件判断并补foot回归，修正近等距歧义对遍历顺序的依赖；232项测试、全仓typecheck/lint及生产构建通过，交接和限制见docs/plans/c-transfer-connections.md。

### Added(Sprint 2 · A /api/path 接入禁转判定,issue #38)

- `/api/path` 新增 `mode` 查询参数(car / walk / bike / bus):缺省仍走基础图(无禁转,与作业一一致);显式给 `mode` 时走该模态子图,注入 `PersistentTurnService.isForbidden` 作为禁转谓词并用 `dijkstraWithTurnRestrictions` 计算——禁转边对与边 ID 只在所属模态内有效,故必须用同一模态的图 + 禁转服务。
- `ModalRuntime` 由接口改为类,新增**惰性** `graph` / `wayHighway` getter:图仅在路径查询首次访问时构建(62.8 万节点 / ~100 万边),转向读写只依赖拓扑与禁转服务,不白白承担构造成本。
- 新增 3 项测试:`/api/path?mode=car` 禁左转后绕行且代价变长、非法 mode 返回 400、显式 mode 但未启用多模态返回 501。
- 全仓 237 项测试通过;server typecheck 与全仓 lint 全绿。

### Added(Sprint 2 · B 转向限制搜索,issue #28)

- 新增 `server/src/graph/turn-restricted-dijkstra.ts`:`TurnRestrictionPredicate`(只读判定 `(via, from, to) => boolean`)与 `dijkstraWithTurnRestrictions`,实现立项文档 §3.3.2 的边扩展状态空间 `(node, inEdge)`——入边唯一确定当前节点,松弛出边前查一次禁转表,不预建展开图。
- `dijkstraWithTurnRestrictions` 为独立入口,不改变现有 `dijkstra` 的签名与行为;未提供谓词时等价于“全部允许”。谓词形态与 C 的 `TurnRestrictionTable.isForbidden` / A 的 `PersistentTurnService.isForbidden` 一致,graph 不依赖 topology/io 具体类型;作业四 A* 复用同一谓词。
- `Graph` 新增只读访问器 `edge(id)`,供边扩展状态按边 id O(1) 取边,避免逐次查询重建全图边映射,保证 62.8 万节点 / 119 万有向边规模性能不退化。
- 新增 6 项测试:空限制与普通 dijkstra 一致、禁左转生效且同路口其他转向不受影响、同一路口不同入边禁转互不影响(节点级标签做不到的关键用例)、禁转使路径改道且代价变长、不可达约定,以及武汉五路口固定夹具(禁左转后绕行、中心节点访问两次证明未错误剪枝)。
- 全仓 234 项测试通过;server typecheck 与全仓 lint 全绿。设计说明见 `docs/plans/b-sprint2-turn-restricted-dijkstra.md`。

### Added(Sprint 2 · E 多模态切换与转换点展示)

- 新增左下角交通模式控制条,可在全量、汽车、步行、骑行、公交之间切换;“全量”用于退出模态过滤并恢复基础路网。首次进入模式和每次切换均显示加载状态,请求失败时保留已有路网并显示错误。
- 切换模式时并行请求 `GET /api/network?mode=` 与 `GET /api/transfer-points?mode=`,重建路网图层和转换点图层,同时清除旧路径、退出选点并隐藏道路属性卡。
- 新增地铁站 `M`、公交站 `B`、停车场 `P` 标记;城市级缩放只显示低透明度小点,放大到 12.5 级后才显示字母,避免大量站点遮挡路网。转换点图层不可拾取,不干扰道路属性交互。
- 使用请求 token 丢弃快速切换产生的过期响应;多模态派生数据未准备时降级显示全量基础路网,不把基础图冒充当前模态。
- 明确标注路径与统计暂按全量基础路网口径,待 `/api/path` 支持 `mode` 后再接入模态路径。
- 新增模式顺序、中文名称、转换点字母映射与缩放阈值测试。

### Added(Sprint 2 · E 转向限制编辑器)

- 新增默认收起的路口转向限制面板,按当前交通模式读取 `/api/intersections/:nodeId/turns`;支持 Node ID 输入和武汉五路口样例 `1881981626`。
- 面板列出路口全部转向动作,显示普通左右直掉头、模糊转向偏角、入口/出口道路、OSM/手动来源和禁转勾选状态。
- 面板下移与 Dijkstra 卡拉开距离,并新增“清空选择”按钮:一次取消当前路口全部勾选,保存后整体清除禁转。
- 保存时按整路口覆盖语义提交 `PUT /api/intersections/:nodeId/turns`,覆盖 OSM 与手动规则;处理保存中、接口错误和 409 禁转快照失配,失败时保留原状态。
- 加载路口后自动将地图聚焦到该位置,以金色环标出当前路口;禁转动作在路口附近绘制红色示意弧线并显示“禁 N”数量,勾选时即时预览,保存失败恢复已保存状态。当前冻结契约不提供入口/出口精确几何,弧线只作状态提示,不作为精确车道几何。
- 地图点击取得最近 `nodeId` 仍缺接口,本版不把 Node ID 输入冒充“地图点击路口”;待 A 提供最近路口查询后再补齐。
- 新增转向文字、边对集合和示意弧线测试;全仓 236 项测试通过。

### Added(Sprint 2 · E 道路属性面板接线与界面对齐)

- 主界面接入已有 `createPropertyPanel()` 组件,删除旧 MapLibre `Popup`、HTML 字符串拼装与手工转义逻辑;点击道路后在鼠标附近悬浮展示完整名称、Way ID、等级和全部 OSM 标签,并自动避开视口边缘。
- 属性悬浮卡进一步收窄,移除与标题旁等级标识重复的“类型”字段;道路等级改为道路名右侧纯文字,“道路属性”转为卡片右下角低对比灰色标识。
- 属性卡在点击空白地图、按 `Esc` 或地图开始移动时收起;进入起终点选点时也会主动收起,保持两种交互互斥。
- 删除主界面的“权重配置”分区及其全局速度、等级限速表、总通行时间预估;将“最快时间 / 最短距离”移入左侧起终点选路卡,未启用选路时显示为不可用,切换目标后自动重算当前路径。
- 右侧统计区更名为“路网与拓扑”,移除实时接口徽标、等级里程占比图和总通行时间 KPI;网络规模与拓扑指标分别使用“路网规模”“拓扑指标”标题并按单行五列排版,等级里程分布和边长分布移至底部上下排列,图表统一使用金色。
- 统计侧栏收窄并默认收起;收起后只保留右侧 300px 标题条,其余区域启用鼠标穿透,不再遮挡地图点击、悬停和起终点选点。
- 统计图去掉多余坐标轴数字与嵌套卡片边框,改用细金色数据条、背景刻度和统一点状标题;起终点选路卡增加金色“Dijkstra最短路径”标题。
- 统一主界面、统计分区、属性卡、起终点选路控件和 MapLibre 导航控件的深色透明毛玻璃视觉:主要容器改为低存在感描边与直角布局,统计卡片使用统一金色,并补充窄屏布局。

### Added(2026-11-05 · C给B的接驳表)

- topology公开buildTransferAttachments与相关类型，返回逐模式可用性、节点、实际接驳路径长度、入出方向和核验记录；未经核验、超距/失配/无入口证据均不可用。
- computeTransferPenalty显式接收步行距离、速度和等待秒数，不混入距离。同步main 5c0d194的REST及PathSegment约定；259项测试、完整typecheck/lint/build通过。真实停车楼入口核验仍待完成，#34不关闭。

### Added(Sprint 2 · 接驳证据，feature/transfer-attachments 未合并)

- 补识别地铁出入口subway_entrance，武汉标记由2596增至2930，仍属walk，旧派生文件须重建。
- 公开逐模式的共享节点/近邻候选匹配及原way入口证据核查，报告距离、并列、权限、屏障和失配，不自动生成转换边。
- 武汉35节点/5条way固定片段验证car/walk分段有向可达与断路负例，停车共享边界仍需核验，未完成跨模态搜索。
- 清理OSM导入重复条件判断并补foot回归，修正近等距歧义对遍历顺序的依赖；232项测试、全仓typecheck/lint及生产构建通过，交接和限制见docs/plans/c-transfer-connections.md。

### Added(Sprint 2 · A /api/path 接入禁转判定,issue #38)

- `/api/path` 新增 `mode` 查询参数(car / walk / bike / bus):缺省仍走基础图(无禁转,与作业一一致);显式给 `mode` 时走该模态子图,注入 `PersistentTurnService.isForbidden` 作为禁转谓词并用 `dijkstraWithTurnRestrictions` 计算——禁转边对与边 ID 只在所属模态内有效,故必须用同一模态的图 + 禁转服务。
- `ModalRuntime` 由接口改为类,新增**惰性** `graph` / `wayHighway` getter:图仅在路径查询首次访问时构建(62.8 万节点 / ~100 万边),转向读写只依赖拓扑与禁转服务,不白白承担构造成本。
- 新增 3 项测试:`/api/path?mode=car` 禁左转后绕行且代价变长、非法 mode 返回 400、显式 mode 但未启用多模态返回 501。
- 全仓 237 项测试通过;server typecheck 与全仓 lint 全绿。

### Added(Sprint 2 · B 转向限制搜索,issue #28)

- 新增 `server/src/graph/turn-restricted-dijkstra.ts`:`TurnRestrictionPredicate`(只读判定 `(via, from, to) => boolean`)与 `dijkstraWithTurnRestrictions`,实现立项文档 §3.3.2 的边扩展状态空间 `(node, inEdge)`——入边唯一确定当前节点,松弛出边前查一次禁转表,不预建展开图。
- `dijkstraWithTurnRestrictions` 为独立入口,不改变现有 `dijkstra` 的签名与行为;未提供谓词时等价于“全部允许”。谓词形态与 C 的 `TurnRestrictionTable.isForbidden` / A 的 `PersistentTurnService.isForbidden` 一致,graph 不依赖 topology/io 具体类型;作业四 A* 复用同一谓词。
- `Graph` 新增只读访问器 `edge(id)`,供边扩展状态按边 id O(1) 取边,避免逐次查询重建全图边映射,保证 62.8 万节点 / 119 万有向边规模性能不退化。
- 新增 6 项测试:空限制与普通 dijkstra 一致、禁左转生效且同路口其他转向不受影响、同一路口不同入边禁转互不影响(节点级标签做不到的关键用例)、禁转使路径改道且代价变长、不可达约定,以及武汉五路口固定夹具(禁左转后绕行、中心节点访问两次证明未错误剪枝)。
- 全仓 234 项测试通过;server typecheck 与全仓 lint 全绿。设计说明见 `docs/plans/b-sprint2-turn-restricted-dijkstra.md`。

### Added(Sprint 2 · A 跨模态路径契约冻结,issue #34)

- 契约冻结:`PathSegment` 进入 `shared/src/index.ts`,`PathResult` 增加**可选**字段 `segments?: PathSegment[]`(非破坏性扩展,单模态路径缺省)。跨模态路径由若干段组成,段间以转换点 id 相接;段内边 id 只在所属模态内有效,`distance` 为各段距离之和(换乘惩罚属时间/成本口径,不计入距离)。A 决策与理由见 `docs/多模态路网设计.md`。
- A 决策:作业二不做公交线路级建模——bus 仅表示「公交通行道路」(`motorRoads + busway`),不含线路、站序、班次与停站规则;答辩口径已写入设计文档。

### Added(Sprint 2 · A 作业二 REST 挂载与派生数据重建)

- 挂载作业二四个接口(issue #33):`GET /api/network?mode=car|walk|bike|bus`、`GET /api/transfer-points?mode=`、`GET/PUT /api/intersections/:nodeId/turns?mode=`;`/api/network` 不带 mode 时行为与作业一完全一致。
- 新增 `server/src/api/modal-runtime.ts`:多模态运行时按需构建(方案 A 懒加载 + LRU 容量 1),道路 GeoJSON 序列化结果单独缓存;四模态完整运行时实测约 2.5 GB 堆,故否决启动构建全部四份的方案 B,实测数据与决策见 `docs/多模态路网设计.md`。
- 新增 `server/src/api/index.ts` 作为 api 模块跨目录公开入口,暴露进程内唯一的多模态运行时注册表:B 的禁转感知搜索(#28)必须与 REST 层共用同一份禁转服务,否则编辑器保存的禁转不会立即影响路径结果。
- 异常映射不留裸 500:400(非法 mode/nodeId/请求体/边对)、404(路口不存在)、409(禁转快照恢复失配,带 `restoreIssues`)、422(转向几何无法判定)、503(派生数据缺 Sprint2 字段);错误响应统一为 `{ error: { message } }`,未知路由同样使用该形状。
- `web/src/api-client.ts` 补齐前端封装:`fetchNetworkByMode`、`fetchTransferPoints`、`fetchIntersectionTurns`、`setIntersectionTurns`(区分「恢复失配」与一般失败)。
- 重建 Sprint2 派生数据(`npm run prepare:data`):nodeTags 6,995 条 / relations 353 条 / transferPoints 2,596 个,旧派生文件会触发 503 降级而非报错;禁转快照落 `data/derived/wuhan-turns.sqlite`,实测 PUT 后重启服务端仍能从磁盘恢复。
- Node 基线决策:`node:sqlite` 自 22.13.0 起不再需要 `--experimental-sqlite`,`engines.node` 收紧为 `>=22.13.0`,启动命令不加标志,保留上游实验性告警。
- 新增根配置 `.prettierrc`(单引号、分号、2 空格、行宽 100),使 `npm run format` 与 CLAUDE.md 的样式约定一致——此前仓库无 Prettier 配置,直接运行格式化会把全仓改成双引号、80 列,产生与功能无关的巨大 diff。
- 新增 16 项测试(模态过滤、转向读写、错误映射、LRU 缓存),全仓 228 项通过;typecheck / lint 全绿。交接说明见 `docs/plans/a-sprint2-rest-handoff.md`。

### Fixed(Sprint 2 · 数据缺口与 SQLite 可交接入口)

- 预处理保留道路节点标签、转换点提取结果与restriction/public_transport/route关系，loader提供扩展数据及旧文件警告；运行时拒绝缺少Sprint2数据的旧派生文件。
- OSM via-node禁转关系解析为source=osm边对，only_*展开为其他出口禁转，保留relation溯源及不完整/失配诊断，不伪造102条全部可用。
- 结构属性疑点进入createTopologyReport，检查内部共享节点而不自动断边；武汉当前规则识别26个疑点，非截图“5个”的直接复现。
- 新增PersistentTurnService/createTurnRuntime，提供启动恢复、来源标记、磁盘优先事务更新与显式清空持久化；恢复失配时禁止覆盖旧快照。
- 全仓212项测试通过；武汉汽车模式SQLite保存/重建运行时恢复通过。脚本改动需A评审，尚未注册REST或修改B/E。

### Added(Sprint 2 · C 基础模块，待评审与集成)

- 禁转稀疏表、路口入出边索引、球面偏角与全部转向动作枚举，以及普通禁转类型和按入口的 only_straight_on 语义归并。
- 手动禁转 SQLite 快照：使用有向道路段及几何匹配恢复当前 edgeId，事务保存，失配明确诊断。
- 四模态独立准入与方向构边、排除记录；原始道路标签保持不变，默认矩阵待 A/B 评审。
- 从武汉原始 node/way 提取转换点标记与模式查询，记录来源及代表点方法；尚未建立真实出入口/换乘连接。
- 武汉五分支小型固定夹具、60 项新增测试、设计与交接文档。尚未注册 API、导入 OSM 禁转或完成 B/E 联调，不代表 Issue #27 已全部完成。

### Added(Sprint 2 前置 · A 契约冻结与流程处理)

- 契约冻结(issue #23):`AttributeCompleteness` 与 `AttributeCompletenessReport` 进入 `shared/src/index.ts`;`NetworkStats.attributeCompleteness` 为可选字段,缺省表示服务端尚未提供该统计(前端不得以 0 冒充完整率),D 实现后由 A 评审收紧为必填。口径为按 way 统计,而非逐条有向边。
- 契约冻结(issue #24,作业二转向限制与多模态):`TravelMode`、`TurnRestrictionType`、`TurnKind`、`TurnRestriction`、`TurnAction`、`IntersectionTurns`、`SetIntersectionTurnsRequest`、`SetIntersectionTurnsResponse`、`TransferPoint` 进入 `shared/src/index.ts`。转向限制按边对存储与判定,`type` 由服务端按几何方位角判定;`turnKind` 与 `angleDelta` 仅供展示;模态接口复用 `RoadFeatureCollection` 与 `TransferPoint[]`。
- 新增 `.github/` 治理文件:`CODEOWNERS`(把立项文档 §4.1 的目录所有权映射为 GitHub owner 审批)、`workflows/ci.yml`(typecheck / ESLint / Vitest / 前端构建)、`pull_request_template.md`(强制填写关联 issue、改动目录、是否涉及契约变更)。
- `main` 的 ruleset「Restrict mian」开启 `require_code_owner_review` 与必需状态检查 `check`:改动他人目录的 PR 需该 owner 批准且 CI 通过;禁止直推与强推的规则沿用原有配置。
- 合并 PR #19(道路属性面板组件)、#20(`/api/path` 与 `PathResponse` 契约)、#21(起终点选路 UI)、#22(Sprint 1 拓扑验证报告与 E 前端设计说明);#19 与 main 的 `docs/CHANGELOG.md` 冲突由 A 解决,双方条目均保留。
- issue 流转:关闭 #18(VIS-3,已由 PR #20/#21 闭环)与 #24(接口形状已冻结,实现拆为 #27/#28/#29);#23 属性完整率契约冻结后交 D 实现,保持 open。
- 同步区(`AGENTS.md` / `CLAUDE.md`)补充作业二契约说明与当前已注册端点清单。

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

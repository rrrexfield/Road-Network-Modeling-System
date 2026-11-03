# C Sprint 2 第一批接入说明（待评审，未对外发送）

基线 main 39e1531；本地分支 feature/turn-restrictions；关联 #27、#28、#29。当前201项测试通过，但功能尚未提交、API未注册、未做三方联调。

## 已实现的公开入口

| 入口 | 能力 | 消费方 |
|---|---|---|
| topology.IntersectionTurnIndex(nodes,edges) | 单图版本入出边索引与手动禁转集合 | A/B |
| index.getTurns(nodeId) | shared.IntersectionTurns；全部入×出边动作、位置和几何 | A/E |
| index.restrictions.isForbidden(via,from,to) | 当前边对是否禁止，默认允许 | B |
| index.restrictions.replace(via,request) | 校验后整体覆盖该路口，返回去重数量；空集合清除 | A |
| index.restrictions.snapshot() | 全部被禁边对，包含无法生成类型的模糊转向 | C/A |
| topology.classifyTurnRestrictions(intersection) | 普通禁转与按入口only_straight_on语义，另返回unclassified | A/E |
| topology.buildModalTopology(nodes,ways,mode) | 模式独立构边，返回mode/topology/excludedWays | A/B |
| io.TurnRestrictionStore(file,dataset) | SQLite快照保存和按当前图恢复 | A |
| io.extractTransferPoints(raw) | 从原始OSM JSON提取转换点和来源诊断 | A |
| io.getTransferPoints(data,mode?) | shared.TransferPoint[]模式展示筛选 | A/E |

所有模块只经 io/index.ts 或 topology/index.ts 引用；不从这些说明直接推断REST已经可用。

## A：路由与启动组装

1. 每个图版本/模式分别构建topology和转向索引，Graph接收相同nodes/edges。原始way属性保持原义；不同模式的边ID不可混用。
2. GET turns用getTurns结果；PUT只接收冻结的SetIntersectionTurnsRequest。参数结构校验和HTTP错误映射由API层负责，C的类方法不是不可信JSON的完整schema校验器。
3. 边对非法则replace整体失败、旧集合不变。不存在路口或几何无法判定时getTurns明确抛错，不把异常伪装成角度0；A/E需决定可识别错误提示或契约扩展，再接编辑器。
4. 持久化保存snapshot的全部边对，不能只保存可分类的restrictions。API内存与磁盘更新需要明确顺序及失败回滚；SQLite事务仅保证磁盘快照整体替换，不代表整个业务更新已原子完成。
5. 启动恢复返回pairs/issues，按viaNode分组后一次replace一个路口。不能逐条replace同路口；失配报告须暴露，不能静默部分恢复。数据库放D盘运行时目录，dataset包含模式，使用原始topology坐标。
6. 转换点目前需要原始JSON：道路派生文件不包含完整POI标签。请决定加载原文件还是另行缓存；C目前没有修改A的scripts或启动文件。缓存应按原数据版本失效，不提交大文件。
7. 模式路由应显示准入excludedWays和方向topology.issues。现有M1 createTopologyReport.scope不可原样作为多模态口径。

## B：禁转搜索

搜索必须携带(node,inEdge)，在松弛出口边前查询isForbidden(via,inEdge,outEdge)。几何turnKind和type仅用于说明，不替代边对判定。

当前只有手动禁转来源；fromOsm始终为false，尚未实现OSM restriction关系导入。规则ID和边ID均为当前图局部身份，不提供跨版本稳定性保证。

真实数据夹具见io/fixtures/wuhan-five-arm.json及c-wuhan-five-arm-fixture.md：原始节点1881981626（武汉一元路/胜利街），五邻接分支、4入×3出=12动作。C侧人工禁左测试已通过，B还需验证状态空间寻路不错误剪枝；不得将人工规则声称为现实禁转。

## E：显示与模式切换

角度范围(-180,180]、右正左负；节点坐标内部[lat,lon]，响应position为[lon,lat]。≤20°直行、≥160°掉头、45°–135°左右转，其余ambiguous，是待评审的项目显示阈值。

fromOsm=false意味着当前只支持手动编辑。遇到unclassified禁转仍应保持禁止，不因没有几何类型而丢弃。only_straight_on当前附在实际被禁边对上作归并说明，不意味着该toEdge是允许的直行目标；A/B/E需确认展示解释与冻结契约无歧义。

转换点way坐标只是包围盒中心，不保证是可达入口；node和way可能代表同一个实体，未去重。模式查询只是标记展示，不证明两个模式的路网在该处可连通。

## 仍未完成的工作

- 真实出入口核对、转换点到各模式路网的可解释连接及跨模态路径；不能简单用最近节点越过围墙或高架连通。
- 武汉五分支候选的人工地图核验、B/E三层固定用例联调。
- OSM禁转来源导入、未支持准入规则和零长度几何的最终交互策略。
- A路由注册、PUT内存/磁盘事务、重启后的运行链路验证。
- 默认模式矩阵、only_*解释和旧Node SQLite兼容的owner评审。

因此该批次可以作为基础模块增量供评审，但不能关闭Issue #27或宣称Sprint 2已完成。

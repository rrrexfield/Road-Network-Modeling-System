# C 作业三：压缩输入与禁转状态交接

2026-11-12；关联 #63/#64，基于 main f8ea4e3。分支 `feature/compression-topology-input`，待审核，尚未接入网页。

## 本次提供什么

- `topology/index.ts` 公开 `CompressionWayIndex`，以当前模式的 `topology.ways` 构造。`get(wayId)` 返回冻结的等级和相关原始标签；`hasBoundary(a,b)` 返回两条道路是否有属性差异。
- 比较 highway 及 maxspeed、oneway、access、foot、bicycle、vehicle、motor_vehicle、motorcar、bus、psv（含冒号子键）。名称不影响边界；不同way但相同属性可以继续成链，原始来源由B的原边序列保留。缺属性明确报错。
- 原始值精确比较，不推断标签语义等价，也不计算权重。方向实际连续性、两个不同邻居判定、模态过滤后链端点、平行边和闭环等由B压缩模块处理，C不重复构建邻接索引。
- `PersistentTurnService.getCompressionState()` 返回 `{ version, protectedNodeIds }`，反映当前实际禁转（含OSM、人工设置及SQLite恢复），不只看原始relations。
- 新服务实例版本为0；每次成功的 `setTurns`（包括空集合和重复保存）后递增，失败不变。这是内存失效代号，不是数据库版本，不新增表。重复保存允许保守失效一次。
- `collectCompressionProtectedNodes(topology.nodes, { turnViaNodeIds, transferNodeIds })` 合并语义保留集、去重，并只纳入当前图节点；不再次扫描拓扑边。

## B/A 如何消费

```ts
// 示意：以下变量均由调用方的同一运行时提供。
const wayIndex = new CompressionWayIndex(runtime.topology.ways);
const state = runtime.service.getCompressionState();
const protectedNodes = collectCompressionProtectedNodes(runtime.topology.nodes, {
  turnViaNodeIds: state.protectedNodeIds,
  transferNodeIds: links.flatMap((link) => [
    ...(link.fromMode === runtime.mode ? [link.fromNodeId] : []),
    ...(link.toMode === runtime.mode ? [link.toNodeId] : []),
  ]),
});
// B在连接两段时调用wayIndex.hasBoundary(inEdge.wayId, outEdge.wayId)。
```

跨模式连接表的两端需按所属模式选取：同一节点ID若也在另一模式存在，直接混入所有端点会产生多保留。调用方应先按当前mode筛选from/to，再传入helper。设施展示pointId不能当路网节点ID。

**缓存由A/B实现**：缓存须绑定具体运行时实例，再用 mode/version 失效；不同服务实例都从0开始，不能仅靠相同数字跨实例复用旧压缩图。道路/拓扑或换乘输入更换时同样需重建。当前API和缓存代码未修改。

`restoreIssues` 已有失配处理继续保留，不能因为新增状态查询而忽略失配并宣称所有旧禁转恢复成功。

## 本次验证

- 属性边界、输入快照、缺属性处理和语义节点合并测试；当前禁转节点、成功保存/清空递增、失败不递增和重启恢复测试。
- 相关4文件23项测试通过；shared/server/web类型检查通过。
- 不重复执行武汉大数据/内存/查询耗时实验，不声称压缩已实现。

## 后续

B消费这些查询并实现压缩与原边映射；A接入实际换乘路网节点、压缩缓存及路由。B产出同一轮压缩节点/边数和耗时后，C再整理报告拓扑部分，不重复计算D已有等级里程统计。

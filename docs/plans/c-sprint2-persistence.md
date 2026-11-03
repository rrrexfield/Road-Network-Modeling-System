# Sprint 2 · C 手动禁转持久化

状态：本地实现，尚未接入 A 的 API 或启动流程。公开入口为 server/src/io/index.ts 的 TurnRestrictionStore。

## 选择与环境

采用 Node 内置 node:sqlite，无第三方包或外部数据库服务。当前 Node v24.20.0 已验证可用，满足任务要求的 SQLite 方案。历史开发基线 Node 22.11 可能需要 --experimental-sqlite；CI 的 Node 22 应选择支持该模块的版本，旧运行时是否升级或增加启动参数需 A 确认，C 不修改根配置。

数据库应位于 D 盘的 data/derived/ 或其他明确的运行时数据目录，父目录由调用方准备，禁止把 SQLite 数据库提交到仓库。没有默认写 C 盘行为。当前测试只在 D 盘临时目录创建小型数据库，测试完成后关闭并清理本次生成目录。

## 保存身份

一个文件可按 dataset 标识隔离多套规则。建议调用方采用明确的数据源标识，可附源文件版本/哈希，不要混用不同城市或数据集。

每个被禁动作保存 viaNode、入口/出口各自的 wayId + 有向段 from/to 节点，以及入口起点、路口、出口终点三处原始 [lat,lon] 坐标。SQLite user_version=1 标记文件格式。绝不将 fromEdge/toEdge 作为永久身份，也不保存由几何计算得到的语义标签来替代边对。

本阶段仅持久化手动禁转集合；不声称已支持 OSM 禁转导入及来源混合。保存应消费 TurnRestrictionTable.snapshot()，不是仅消费 classifyTurnRestrictions().restrictions，后者可能不包含模糊几何的禁转。

## 调用与原子性

1. `store = new TurnRestrictionStore(databasePath, dataset)`。
2. `store.save(topology, index.restrictions.snapshot())` 校验完整集合后，事务替换该 dataset 的快照。重复边对去重、空数组清空；其他 dataset 不受影响。非法提交不会破坏原快照。
3. 重启构建新 topology 后，`store.restore(topology)` 返回当前图边对和失配明细，不自动修改运行中的表。
4. **按 viaNode 分组后**，对每个路口调用一次 `replace(viaNode,{forbidden:该路口全部边对})`，不能对同路口逐条 replace，否则后一次会覆盖前一次。启动恢复应装入新建空表；恢复到已有表时应先明确全量替换语义，不能只叠加。

必须传 TopologyResult 的原始坐标；不要用 Graph 的 Float32 压缩坐标回写快照，否则严格几何比较会发现精度变化。

对于 API 更新后的内存/磁盘一致性，A 集成时需明确操作顺序与错误回滚，当前存储事务只保证数据库快照的原子性，不保证尚未接入的 API 整个业务事务。

## 恢复诊断

- missing-segment：wayId/有向端点未匹配，跳过并报告。
- ambiguous-segment：同一稳定标识匹配多条边，不任意选择第一条。
- geometry-changed：节点坐标变化，跳过并报告；当前严格比较，不模糊吸附。
- 非法 JSON、格式不正确或未知版本：抛错，不返回部分恢复结果，也不覆盖数据库。

多条记录中部分失配时返回有效边对和全部 issues；A 必须展示或记录警告，不能悄悄把部分恢复解释为完整成功。

## 验证边界

测试覆盖新建实例模拟重启、edge ID 重排、落表不含易变ID、无效提交保留旧快照、去重/清空/数据集隔离、道路段变化、多匹配、几何变化及损坏/未知版本。尚未完成编辑器保存→服务端持久化→进程重启→搜索受限的全链路验收。

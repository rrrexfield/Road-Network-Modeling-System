# PR草稿（待用户审核，未发布）

标题：fix(topology): 按模式过滤受限节点并保留准入诊断

## 关联

Refs #34（已关闭后的遗留，不自动重开/关闭）；关联#43、PR #42。A尚未确认节点准入具体策略，本PR提供C侧可评审实现。

## 改动范围

- C：server/src/topology、server/src/io及测试夹具。
- shared契约无变更。buildModalTopology增加兼容的可选第四参数NodeTags，返回nodeAccess诊断；io/createTurnRuntime已接入。
- README、CHANGELOG、AI日志、协作同步区和交接文档按仓库要求更新，需A评审；未修改A/B/E实现。

## 改动说明

此前way准入不会检查沿途nodeTags，扬波门foot=permit仍能穿越。本实现按模式优先级检查节点权限/屏障，移除受限或未决节点的相邻有向段，不跨缺口补边。保留原始数据、剩余edgeId和方向，未传标签的旧调用保持原行为并明确checked=false。

no/private/permit排除；相关条件/方向权限及未知语义保守排除；foot=yes等具体许可可覆盖一般限制。屏障没有一律禁止：列出的已知屏障在有显式模式许可时通过，无许可/未知屏障报告并排除。此保守策略会误排实际可通行闸门，需A确认，不宣称完整OSM或实景导航语义。

SQLite回归验证过滤导致部分恢复失配时，仍保留可匹配规则并禁止写入覆盖旧快照，恢复原图后旧规则仍在。

## 验证

- [x] npm run typecheck（全部三包）
- [x] npm run lint
- [x] npm test：399项通过，本分支新增24项（含此前准备的2项基线）。
- [x] npm run build（既有体积警告）
- [x] 武汉四模态全量构图与排除原因核对，详情见docs/plans/c-node-access-ready.md。
- 无可视化代码改动；未做浏览器接线验收，未冒称网页已启用。

## 文档与日志

- [x] README/CHANGELOG/AI日志/同步区已更新，理解自评由用户填写。
- [x] 无AI提交署名，无大数据与派生生成物入库。

## A/B接入事项

A的ModalRuntimeRegistry两处buildModalTopology调用仍需传network.nodeTags并保存/记录诊断；随后重建Graph、转向/nearest索引、换乘缓存，核对SQLite恢复失配及网页行为。未接入前旧调用仍为checked=false，不能说网页节点权限已经修复。空坐标及近似证据下发不在本PR范围。

# PR草稿（待用户审核，未发布）

标题：feat(topology): 提供逐模式接驳表、核验诊断与换乘罚时计算

## 关联

- Refs #34；关联#28/#29/#33。本PR不关闭#34。

## 改动范围

- 实现目录：C的server/src/io、server/src/topology。
- 不涉及新的shared契约变更；合入main 5c0d194，保留A的REST与PathSegment约定。
- README、AGENTS/CLAUDE同步区、CHANGELOG、AI日志及交接说明按仓库要求同步，需A评审。未修改B/E的实现。

## 改动说明

转换点此前只有标记和候选证据，B无法直接判定某模式节点是否可用于搜索。本PR提供buildTransferAttachments，经topology/index.ts导出Map<转换点ID,各模式接驳结果>，包含可用状态、节点、实际接驳距离、当前模式入出边、核验来源及不可用原因。只有显式核验记录且端点/阈值/入口证据与当前图一致才可用，默认不把近邻或共享边界自动建成转换边。

computeTransferPenalty接收实际步行距离、速度和等待秒数，返回秒；无默认等待/速度，不将罚时加入PathResult.distance。A/D提供速度与策略配置，B负责组合成本。

同时包含此前未创建PR的候选匹配、区域入口检查、334个地铁出入口补提取及OSM重复判断修复；武汉标记2930（bus1231/subway659/parking1040），合并后须重建派生数据。提供武汉35节点/5way片段及分段可达、断路负例。该停车楼入口尚需实景/地图核验，未宣称跨模态搜索或实景换乘已完成。

## 验证

- [x] npm run typecheck（shared/server/web）
- [x] npm run lint
- [x] npm test：259项通过；本次新增11项测试，整个C分支含此前20项新增测试。
- [x] npm run build（大包体积警告）
- 无可视化代码改动；未声称在浏览器完成跨模态交互验收。

## 文档与日志

- [x] CHANGELOG、README、协作同步区与AI日志已更新；理解自评由用户填写。
- [x] 无AI提交署名；大数据与生成物不入库。
- B调用方式、核验责任与成本口径：docs/plans/c-b-attachments-ready.md。

## 尚需联合完成

入口/楼层核验和实际核验记录；A/B/D确认阈值、速度和等待策略；B跨模态搜索、E按段渲染；A重建含新地铁入口的派生文件。均不以本PR自动完成。

# C节点权限复用入口（2026-11-07，待评审）

分支feature/node-access-query，基于main9d86496；C公开evaluateNodeAccess与NodeAccessDecision，构图过滤改为调用同一个判定入口，原有规则和图结果不变。未改A/E实现或shared契约，尚未推送/创建PR。

```ts
import { evaluateNodeAccess } from '../topology/index.js';
const decision = evaluateNodeAccess(sourceNodeTags, mode);
if (!decision.allowed) {
  // 该设施的此模式不得进入nearby匹配；保留decision.reason供诊断。
}
```

输入是原始节点的完整标签数组，模式为car/walk/bike/bus；不依赖节点ID、坐标或是否在图中。因此可检查“设施自身不在路网上”的源节点，而非只检查已入图的excludedNodes。输出为：

- 标签undefined：`{ checked:false, allowed:false, reason:'node-tags-unavailable' }`，不能自动按无权限限制处理。
- 已知标签且不被现有规则排除：`{ checked:true, allowed:true }`。
- 被规则排除：`{ checked:true, allowed:false, reason }`，与构图诊断使用同一原因。

**[]必须表示已确认该节点没有标签，不得用`nodeTags.get(id) ?? []`掩盖来源缺失。** 当前派生文件的nodeTags只保存道路节点标签，不能保证覆盖全部图外设施。A接入前须确定完整设施标签来源（如保留原始设施source标签后重建派生文件）；本次没有修改提取格式或替A宣称缺失数据已补齐。不得将way代表点当节点标签交给本入口来证明真实入口。

checked/allowed是规则判定，不是实景、入口、楼层或步行接驳路径核验。屏障、permit、条件准入及模式覆盖规则仍沿用#56的保守策略，不在此重复定义一套规则。buildModalTopology三/四参数兼容行为保持不变。

## 验证

新增16项：14条建议权限矩阵对照同一构图结果；缺失标签/明确空标签/未知模式；图外permit设施拒绝与模式覆盖、输入不变。

合成接线演示（data/derived/node-access-preview/check-query.ts）：对带foot=permit/motor_vehicle=permit的停车设施，现有A的buildTransferLinks直接调用会生成2条近邻连接；测试脚本先按本入口过滤source.modes，再调用原函数，结果为0条。A的API源码未改，这不是网页已接入，只证明入口足以供调用方实现该项拦截。过滤不能只对匹配目标节点做，必须先判设施原始source标签。

全仓416项测试通过、完整typecheck、lint、生产构建通过（既有体积警告）。初次检查因本机缺main已锁定的FontAwesome7.3.1失败，随后在D盘隔离补齐并建立本地依赖连接后重跑通过；没有修改清单/锁文件或放C盘缓存。

## 仍需A/E完成

1. A确认设施完整标签的数据来源、缓存更新和缺失标签诊断，把本入口接到连接表构建前。该入口只提供可复用判定，本分支未修改A的buildTransferLinks。
2. A/E修复模态GeoJSON整way残留受限段；本次没有修改几何输出。
3. 接入后重建换乘缓存，并以受限设施、明确许可和图外设施分别做HTTP/路径回归。用户界面仍须说明未核验近邻近似。

## 拟发PR正文（待用户审核，未发布）

标题：feat(topology): 公开设施节点权限查询并复用构图规则

关联PR #56/#58及#34遗留；不自动关闭/重开事项。

改动范围为C的server/src/topology和配套文档/日志，shared契约无变更；协作同步区和README按仓库要求更新，需A评审。公开evaluateNodeAccess(tags,mode)/NodeAccessDecision，允许A在设施尚未入图时复用已有权限/屏障规则；构图也调用同一实现，避免两套规则。标签来源缺失时checked=false且allowed=false，不默默当空标签。

新增16项测试；全仓416项、完整typecheck/lint/build通过。合成演示在调用方加该判定后，受限设施近邻连接由2条变0；A正式代码未改。没有声称网页换乘或GeoJSON残留已修复。设施完整标签来源仍需确定，不能用只覆盖道路的nodeTags Map推断所有图外设施无标签。无大数据入库、无AI署名，AI理解自评由用户填写。

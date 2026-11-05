# #34 回复草稿（未发送，待用户审核）

@HCl2778 @rrrexfield @heocean3-cmyk

C已按B的两项输入要求补齐接口，公开于topology/index.ts：

- buildTransferAttachments：Map<TransferPoint.id, 各mode结果>，available含nodeId、实际接驳路径distanceM、incomingEdgeIds/outgoingEdgeIds和reviewReference；unavailable明确超距、未装载、未核验、几何失配、无入口证据等原因。不同模式可接不同节点；方向/edgeId只属于本模式、当前图。
- computeTransferPenalty：实际步行米数 / 步行速度(m/s) + 等待秒数，输出秒。C提供路径/距离证据，速度由A/D配置，等待策略由A/B确定，B组合成本；无默认罚时，不计入PathResult.distance。重叠路径不能重复计费，汽车接驳也不能直接当步行。

main 5c0d194已同步。259测试、完整typecheck/lint/build通过；具体调用见docs/plans/c-b-attachments-ready.md。发布时补本次获批PR链接。

请B先按该入口接搜索及测试；真实场景仍需补核验记录：停车楼1499199682的节点13707011477仅有共享边界证据，无明确入口/楼层核验，所以默认不可用。请A协助确认此入口或选择证据充分的替代设施；C没有把原来的24米汽车+196米步行分段可达当作实景换乘完成。未关闭#34。

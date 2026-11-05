# C → B：逐模式接驳接口（2026-11-05）

已将main 5c0d194（含A的REST与PathSegment契约）合入feature/transfer-attachments功能分支。本次实现只在C的topology中；代码已推送并创建PR #42，尚未合入main，待A评审。2026-11-05远端CI通过；入口核查及权限边界见c-pr42-selfcheck.md。

## 公开入口

```ts
import { buildTransferAttachments, computeTransferPenalty } from '../topology/index.js';
const table = buildTransferAttachments(
  transferPointData,
  { car: carTopology, walk: walkTopology }, // 仅需要nodes/edges，不需要完整禁转运行时
  { car: 100, walk: 200, bike: 100, bus: 200 }, // 示例策略，须由集成方确认
  reviewedAccessPaths,
  entranceReport, // way设施核验必须提供inspectTransferEntrances的结果
);
const car = table.get(transferPointId)?.car;
if (car?.status === 'available') {
  // car.nodeId：当前car图节点；incomingEdgeIds：可到达；outgoingEdgeIds：可离开。
  // 转入汽车段必须有outgoing，转出汽车段必须有incoming；由B按段角色检查。
}
```

返回 `Map<TransferPoint.id, Partial<Record<TravelMode, TransferAttachment>>>`。相关模式各有一项，未相关模式缺省，不拿其他模式补齐。Map仅在服务端使用，不直接JSON下发，shared契约保持A冻结的版本。

available项包括nodeId、distanceM、accessPath `[lon,lat][]`、incomingEdgeIds、outgoingEdgeIds、reviewReference。unavailable项包括reason，可附candidateNodeId/distanceM；B只能消费available，不得把候选节点当已可通行连接。同节点ID跨模态可相同，但边ID和入出边只在本模式/本次构图有效。

## 接驳可用性与核验输入

`TransferAttachmentReview` 是 `{ pointId, mode, nodeId, accessPath, reference }`。调用方先用地图/现场/可解释的道路证据核验，再提供设施入口至该模式节点的实际折线及记录链接/编号。C不会把书写了reference等同于核验者身份认证；外部应用不得让不受信任客户端直接提交“已核验”记录。

- 点型：路径首点须与该转换点坐标完全一致。
- way型：首点须来自entranceReport中同设施、同模式的边界入口证据，中心不能代替入口。
- 末点须与当前模式节点坐标一致，避免失效记录在重建图后静默沿用。
- 按实际折线球面总长判阈值，不用端点直线距离绕过绕行距离；所有坐标须有限合法。
- 模式未装载、缺核验、节点不在图、来源/坐标失配、入口无证据、路径超距或节点无有向边均不可用；重复记录/非法阈值/未知转换点模式拒绝整次调用，避免覆盖歧义。

没有reviews时返回完整不可用诊断与可用的近邻提示，不自动接受共享节点。该方法不创建图边；B据已核验记录建立段间衔接。本模块不检查核验折线沿途是否穿过屏障，核验方必须检查准入、屏障、分层和通行方向。区域报告也只提供入口证据，不能替代实景核验。

## 换乘代价的责任和单位

```ts
const seconds = computeTransferPenalty({
  walkingDistanceM: 120, // 示例：已核验的实际接驳步行路程，C提供几何/距离证据
  walkingSpeedMps: 1.5, // 示例值，不是冻结默认；A/D提供速度配置，B传入
  waitingSeconds: 30,   // 示例值；A/B决定停车/等待策略，B传入
}); // 示例结果110秒
```

C只做 `实际步行米数 / 步行米每秒 + 等待秒数`，拒绝非法参数/溢出，没有默认速度或等待罚时。B负责将输出纳入时间/成本目标；`PathResult.distance`按A冻结约定只累加各段距离，不加等待秒数。car段接驳路径不一定是步行，不能把各模式distanceM机械相加当步行距离；两模式接驳路径重叠也不能重复收费，需要B按实际转换过程确定walkingDistanceM。同一共享入口可以是0米，但等待是否为0仍需显式配置。

## 当前验证与尚未完成

259项测试、shared/server/web完整typecheck、全仓lint与生产build通过（既有大包体积警告）。本批新增10项接口/成本测试和1项武汉防误用测试，同步main后其他测试均通过。

武汉35节点/5way固定片段仍只证明分段有向可达；停车设施1499199682是multi-storey，入口没有显式entrance标签。测试断言它在没有核验记录时保持unavailable，未伪造一份现场核验。需A/成员确认真实入口/楼层，或选另一个证据充分的设施，才能做实景换乘演示。

B现可消费接口形状实现搜索与测试，不必等待新的shared类型；真实场景仍等核验记录，速度/等待具体策略仍需A/B/D确认。尚未实现B跨模态搜索、E分段渲染，#34不能关闭。合并后A还需重建派生数据，把2596标记更新为本分支的2930（含334地铁出入口）。

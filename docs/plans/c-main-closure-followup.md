# 作业二关闭后的main独立复核（2026-11-06）

基线main 70f7389。分支docs/main-followup-audit，只核查并记录，没有修改A/B/E实现或重开issue。原test/node-access-fixtures分支cdf2590及其材料完整保留。

## 已确认的新交付

#34/#43已由A关闭，跨模态搜索、接口和分段展示已合入main，地铁不包含乘车建模，bus仍只是公交通行道路。A公布的2447连接/371测试为A的全量验证结果，本次未重复全量运行或冒称重新独立核对这些数字。

本次使用最新main模块，以Fastify.inject和小型原始/合成数据独立复现下列行为。临时脚本data/derived/main-followup-audit/check.ts与results.json在D盘忽略目录，不启动公开服务，不写持久化数据库。

## 1. 空坐标问题仍存在（建议A补修）

server/src/api/modal-routes.ts的parseCoordinate仍用Number(raw)，未拒绝trim后空字符串。以一个原点[0,0]的合成三邻接路口注册真实registerModalRoutes，只替换运行时数据源：

| 请求 | 实际结果 | 预期区别 |
|---|---|---|
| /api/intersections/nearest?lon=&lat=&mode=car | 200，命中node0，position=[0,0] | 空坐标应400 |
| 同接口lon=%20%20&lat=%20 | 200，命中node0 | 空格应400 |
| 同接口lon=0&lat=0 | 200 | 合法0应保留 |

这次是HTTP路由注入复现，不只测Number函数。数据源为合成原点图，不声称武汉有原点路口；在武汉查询空参数往往表现404，也仍属错误参数未被400拒绝。

## 2. 节点准入仍未实施（建议A/C确认修复）

buildModalTopology仍是三参数nodes/ways/mode，ModalRuntimeRegistry两处调用均不传nodeTags。把cdf2590中3节点/1way的原始扬波门夹具作为输入，最新main的walk图与Dijkstra返回：

`13565585882 → 1358787382 → 1358787402`

中间节点1358787382仍标foot=permit、access=permit、barrier=gate。节点标签不在构图输入内，因此关闭#34并未使公众准入校验自动生效。本轮不推断有其他替代路线，也不删除原始数据；建议沿用已发布C参数/过滤/诊断、A运行时接线、B统一图的方案，单独跟踪修复。

## 3. 自动近邻连接是新采用的近似策略，不是严格核验接驳表

api/transfer-links.ts调用matchTransferConnections + computeTransferPenalty，不调用buildTransferAttachments；way型设施不连接。点型设施在不同模态分别找最近节点，直接把近邻候选落成搜索连接，并保留evidence。A已在关闭说明中披露1995条近邻近似，因此这不是本次偷换成“实景核验通过”的依据，C的严格接口也没有被改为自动放行。

合成对照：停车设施位于[114,30]，car节点10与walk节点20均在[114.0001,30]。两节点ID不同，距设施各约9.630米。最新buildTransferLinks自动生成car→walk及walk→car两条nearby-candidate连接；相同输入的C严格接驳表在没有review时仍返回unavailable/review-required。

接驳距离accessMeters取的是两个模态节点之间的球面直线长度，**不是经设施的实际步行路线长度**。本例两图节点坐标相同，所以accessMeters=0，停车罚时仅300秒。此结果符合现有近似实现，但不能拿0米证明已到达停车设施，不能把此数称作实测接驳步行距离。速度1.3m/s和停车/公交等待时间均为模型参数，等待值仍是占位。

## 4. 近似证据目前没有下发至路径响应/页面

transfer-links内部保留evidence与accessMeters；但api/multimodal-path.ts构造searchLinks时只复制模式、节点、罚时、设施ID，未复制evidence/accessMeters。路径响应只组装segments与transferPenaltySeconds，没有所选换乘的证据字段。web/map/cross-modal-path.ts只按段着色、画换乘点、显示距离/时间摘要，没有读取或展示近邻证据。

因此可以说“连接表与文档保留近似证据”，当前代码不足以支持transfer-links注释中的“前端都能看到近邻近似”这一说法。建议A/E提供总体“跨模态接驳采用几何近似、未核验”说明；如要逐换乘标注，由A冻结可选字段后在响应及前端接通，C不自行扩展shared。

## 本次验证边界

小型断言均通过：真实permit闸门的旧行为、空坐标HTTP响应、合法0坐标保留、自动近邻连接与严格接口的差异。它们证明问题仍可复现，不是修复回归通过。本次不重复全仓测试，因为没有改变生产代码；文档差异检查通过。没有对真实武汉全量重新跑跨模态搜索，没有做浏览器实景入口验收。

## 拟补充给A的回复（待用户审核，未发送）

建议在#34发布一次并关联#43/#50，避免自动重开已关闭issue；由A决定另开缺陷跟踪。

@rrrexfield @HCl2778 @heocean3-cmyk C已在main 70f7389独立复核关闭后的实际实现。跨模态新链路已落地，但以下遗留请另跟踪，不把关闭状态当作已修复：

1. #43空参数仍可复现：真实registerModalRoutes + 合成原点路口HTTP注入，lon=&lat=及纯空格均返回200并命中[0,0]，不是400；合法0仍应保留。请A在Number前拒绝trim后空值，并补HTTP回归。
2. nodeTags仍未传入构图，原始扬波门3节点片段在walk图仍可穿过foot=permit闸门。请A确认C的兼容nodeTags方案及后续运行时接线，建议单独缺陷跟踪，不擅自重开#34。
3. 当前自动近邻是A采用的几何近似策略，不是调用C严格review接驳表；accessMeters只是两模态节点间球面距离。相同坐标的两图节点即使离停车设施约9.63米，也会产生0米接驳，不能称作经设施实测步行距离。
4. evidence目前只留在内部连接表，multimodal-path响应和前端未传/显近似证据；建议A/E先补总体近似说明，如需逐换乘标注请A冻结可选字段。C未改shared或A/B/E实现。

发布时补本报告链接；请A确定修复顺序和跟踪位置，再由C继续节点准入实现。

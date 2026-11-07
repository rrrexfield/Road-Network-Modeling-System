# PR #58合入后的实际main验证（2026-11-07）

基线main9d86496（含#56/#58/#57），独立分支docs/node-access-web-audit。本轮只核查并更新C文档，不改A/B/E正式实现，不重复创建修复，不重开已关闭issue。

## 验证方法

使用真实main的createModalRuntimeRegistry、registerModalRoutes、Graph/Dijkstra及prepare/loadNetwork，没有修改运行时副本，也没有mock掉构图或换乘算法。只有数据是5节点合成夹具：way100=1—2—3—5、way101=2—4；节点3含foot=permit、motor_vehicle=permit、amenity=parking。节点坐标与此前预验证一致，点3距点2约96米。

Fastify.inject验证nearest/turns；featuresJson检查实际注册表输出；transferLinks检查真实换乘连接结果。临时SQLite、派生数据和脚本均在D盘，不覆盖用户数据库。脚本data/derived/node-access-preview/check-main.ts及结果main-results.json被Git忽略。没有使用浏览器，也没有重新执行全仓400项测试；本次断言证明以下具体行为。

## 已验证正确接入

- runtime.nodeAccess.checked=true，node3以node-permit-required排除，删除4条相邻有向边；car/walk图均不存在node3。
- 点击node2原路口位置，nearest返回404（剩两个邻接节点）；turns仍可查且只有4项（2入×2出）。
- 同一walk运行时Graph中1→5不可达，不会穿过受限node3；这是固定原节点Graph查询，不冒称REST路径吸附后的端点不变。

因此PR #58确实使网页运行时启用了C节点过滤，不能继续沿用“还没传第四参数”的旧判断。

## 遗留一：模态GeoJSON仍画出被过滤的段

way100还保留1—2这一段，buildFeatures据此保留整条way，随后复制完整原始nds。实际返回LineString仍为：

`[114,30] → [114.001,30] → [114.002,30] → [114.003,30]`

后两段经过被过滤node3，与可通行边集不一致。本次对featuresJson进行断言，不只是阅读源码。建议A/E按剩余可通行物理段输出连续片段，或在界面明确受限段；不能为了拼接保留节点而跨缺口造线，须由A确认现有RoadFeature与前端拾取如何表达片段。

## 遗留二：受限设施仍被nearest回退重新吸附

转换点ID6对应node3停车设施。car/walk图已排除node3，但buildTransferLinks没有消费设施自身模式权限，仍将两模式接到邻近node2，产生：

- car,node2 → walk,node2，nearby-candidate，accessMeters=0，penaltySeconds=300；
- walk,node2 → car,node2，同上。

这说明“图中已排除受限节点”不等于“该设施不会再参与换乘”。0米来自两个匹配节点相同，不证明可进入96米外的设施。建议A在构建连接前按设施原source节点标签判断相关模式资格；nodeAccess.excludedNodes只能覆盖原先入图节点，不覆盖所有图外设施，因此不能只靠这一列表解决。若需C复用判定入口，可另确认公开接口；C本轮未扩shared或改A的连接表代码。

两项都是此前临时预验证指出的问题，目前已用main正式模块再次复现。它们不否认C过滤与A接线本身生效，但不能据此宣称地图和设施换乘权限端到端完全一致。

## 拟发PR #58评论（待用户审核，未发送）

@rrrexfield @HCl2778 @heocean3-cmyk C已在实际main9d86496（非临时修改副本）验证：runtime.nodeAccess.checked=true、permit节点被排除、nearest/turns/Graph随过滤更新，感谢A完成#58接线。

此前两项预验证残留仍可复现，建议另立后续修复跟踪：

1. way100=1—2—3—5、node3受限时，图只剩1—2，但featuresJson仍输出完整way100含node3/5坐标。请A/E决定按可通行段拆分几何或标明受限段，不跨缺口补线。
2. node3若标amenity=parking并有foot/motor_vehicle=permit，图上虽已排除，但真实transferLinks仍把它吸附到约96米外node2，产生两条car↔walk近邻连接。需在连接表构建前检查设施自身模式权限；仅excludedNodes无法覆盖图外源设施，若需C公开复用入口请确认形态。

本轮只做合成小数据HTTP/Graph/连接表复核，无生产改动，不重开已关闭事项；发布时附本报告链接，具体修复归属与顺序请A确认。

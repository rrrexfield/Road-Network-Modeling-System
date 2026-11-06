# PR #56：API接入预验证（待用户审核，未发送）

2026-11-06，代码a84c8dd，PR #56 OPEN、CI SUCCESS，查看时无评审/评论。本次不改生产实现：将A的modal-runtime.ts复制到data/derived/node-access-preview，**仅在2处buildModalTopology调用补network.nodeTags**，另调整副本相对导入以引用真实模块；实际API文件未变化。

使用合成5节点图（非武汉现场）：way100为1—2—3—5，way101为2—4。节点3标foot=permit、motor_vehicle=permit、amenity=parking。注册真实registerModalRoutes，SQLite临时库与分析脚本均在D盘，未覆盖实际用户数据库。

## 通过的接入断言

- 节点2原有3个不同邻接节点，nearest HTTP返回200；接入过滤后只剩邻居1/4，重建索引后同点击返回404。
- 节点2的turns HTTP仍返回200、4个剩余转向动作（2入×2出），不再含节点3方向。
- 直接在同一运行时Graph查询1→5不可达，受限节点3和隔离节点5不在可通行图中；此项是Graph断言，没有把服务端自动吸附后的路径当同一端点验证。

## 补参数后仍需A处理的两项

**1. 模态GeoJSON存在受限段残留。** buildFeatures按“way只要还有一条边就纳入”筛选，随后复制该way完整原始nds。way100仍有1—2可通行，所以输出原始1—2—3—5整条LineString，包含已排除节点3的坐标。运行时图不通，但按模式图层仍可能显示完整线段。不能把“整条way还有边”等同于“整条way每段均可通行”。

请A/E决定按剩余有向边对应的原始物理段输出连续几何片段，或将受限段清晰标注为不可通行；不能为拼线而跨过被排除节点。保留way属性与原始几何数据不等于模态渲染也必须标成可通行，不由C擅自更改RoadFeature契约或A/E实现。

**2. 换乘连接会重新吸附到受限设施附近。** 节点3被两个模式图移除，但转换点标记仍在原始TransferPointData中。buildTransferLinks只看到过滤后的节点表，matcher把停车设施从源节点3改吸附到邻近节点2（约96米，落在car100/walk200米阈值内），生成两条car↔walk nearby-candidate连接。两个模式选中同一坐标，accessMeters=0，等待罚时300秒。这不是证明停车场仍能进入，而是设施自身准入未进入连接表构建。

建议A保留每模式nodeAccess诊断，结合sourceId和sourceType=node检查设施自身模式权限，至少不能把已按该模式排除的源节点通过nearest回退重新放行；同时需明确点标签完全未入图时的设施准入来源（仅excludedNodes不覆盖图外源节点）。若需要完整设施节点判定，C可在另行确认后提供复用入口，避免A独立重写规则。不能把当前构图checked=true直接解释为所有转换点标签也已校验。

## 发布与后续边界

本轮全部预验证断言通过，证明这两处残留问题可以复现，不是“端到端修复通过”。没有重跑全部399测试（生产代码未变化）、未改A/B/E文件、未新增依赖或正式服务，不合并PR、不重开issue。

原始副本、check.ts、results.json在data/derived/node-access-preview，均被Git忽略。PR #56的C侧过滤、诊断和io接入实现不变；网页接线需连同几何一致性、设施自身权限、索引/缓存重建一起由A/B/E评估。

## 拟发PR #56评论（待用户审核）

@rrrexfield @HCl2778 @heocean3-cmyk C补做了PR #56接入预验证：只在D盘临时副本中给ModalRuntimeRegistry两处构图调用补nodeTags，未改正式API。

5节点合成图验证：过滤后nearest从200变404，剩余路口turns为4项，Graph不再穿过permit节点。与此同时发现两项接线残留：

1. buildFeatures按way保留完整nds，way只要剩一段就仍画出受限段。请A/E处理连续可通行几何或清楚标注受限段，不能跨缺口补线。
2. 受限节点若也是停车标记，自动buildTransferLinks会将它重新吸附到约96米外的节点，生成car↔walk近邻连接。请保留/使用每模式nodeAccess诊断，并明确设施自身的权限校验，避免源节点已排除却经nearest回退放行；图外设施权限不能只靠excludedNodes覆盖。

这两项需要A接线时一并评估，不能仅补参数就宣称网页联调完成。PR #56现有C侧代码未变；若需要C公开完整节点判定以复用，请确认接口形态后安排。发布时附本报告链接。

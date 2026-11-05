# C审查：#43 / PR #44（待审核，未发送）

日期2026-11-05。审查PR #44提交bf78bede2ce85a00da2d90c2e799bce8ce17c4c6，base=feature/property-mount。PR检查成功；该状态不代表C已批准所有边界行为。独立文档分支docs/intersection-review基于main 769504a，不修改A/E实现。

## 核查范围与结论

只审查C相关的路口拓扑判定、空间索引、路由参数校验及既有转向接口衔接，没有重测PR中的前端保存重算流程。读取A的源码和测试后，在data/derived/pr44-review中保存原始索引代码快照，仅把weights公开入口的相对导入路径改成本地等价路径以运行；parseCoordinate函数原样提取独立执行。check.ts及results.json为本机忽略文件，不提交第三方目录代码。

已通过的独立断言：

- 两臂双向道路不会因边数翻倍被识别为路口；邻接节点Set去重正确。
- 武汉原始五路口片段1881981626，car图原位置命中、distanceMeters=0、degree=5，connectedWayIds=[177782886,177782996,1314582147]，道路名胜利街/一元路；同一拓扑的转向枚举有12项。
- 合法坐标及越界/缺参校验按源码行为核对；未在HTTP层启动PR服务器，以下参数问题是原函数运行复现和路由调用链核查，不冒充完整HTTP冒烟。

结论：当前模态内按不同邻接节点>=3进行路口选择，符合A已冻结的交互口径。它只是拓扑分支点判定，不保证存在可编辑转向、公众通行或地面交叉；不能凭坐标相交补造节点，也不建议仅凭bridge/tunnel标签删除原始共享节点。

## 应修正：空字符串经纬度被接受（P2）

PR的server/src/api/modal-routes.ts中parseCoordinate仅检查typeof与Number(raw)。实际执行：

```ts
parseCoordinate('', 180) === 0;
parseCoordinate('   ', 90) === 0;
parseCoordinate(undefined, 90) === null;
```

因此请求中的空经纬度会静默变成0，而不是被路由返回400；如果0坐标附近恰有路口还可能命中错误地点。建议Number转换之前拒绝raw.trim()===''，保留合法'0'；补参数和HTTP路由空值/空格回归。属A目录，请A修复，C未越权修改。

## 两项需明确口径的边界（不是已冻结规则的阻断缺陷）

1. 完全等距的两个不同nodeId：构造同坐标且各有3邻接节点的两个路口，边数组顺序A→B时返回10，B→A时返回20。当前只比较distance<best，结果依赖插入顺序。该图可表示分层或重复节点，不能仅凭坐标认定同一路口；建议A/E决定确定性tie-break或提示继续放大，不由C新增响应字段。若采用最小nodeId，须注明它只保证稳定，不证明物理层级正确。
2. 只有出边或只有入边的三邻接节点：合成图0→1/2/3，nearest返回degree=3，但getTurns(0)结果为空。按当前“邻接>=3”契约并未违规。建议A/E明确是排除无入出组合节点，还是允许查询并显示“没有可编辑转向”；不要自动把degree等同于转向动作数。

## 模块归属与节点准入

本次不建议为目录整洁而迁移IntersectionIndex：它当前服务REST查询、组装NearestIntersectionResponse和way名称，保留A的api目录可减少联调改动；C认可上述邻接去重口径。未来多个模块需要同一判定时，再将纯拓扑分类提取至topology公开入口，API继续负责参数、DTO和HTTP状态码。

节点权限是另一个需要落实的问题，不由nearest解决。建议C给buildModalTopology增加兼容的nodeTags输入和准入诊断，io/createTurnRuntime传入已保留标签；A同步修改ModalRuntimeRegistry两处构图调用，B消费同一份图。筛掉受限节点相邻有向段，不跨缺口补边，过滤后重新构建nearest索引、转向索引与Graph；保持SQLite按原道路段身份恢复，失配明确报告且不覆盖旧库。模式优先权限（例如access=no但foot=yes）、条件权限与屏障规则需统一，不用四处独立补丁。

以上是具体实施提案，尚待A确认；没有把A“建议评估”当作已批准改动A的目录。本次未实施节点准入修复。

## 拟发#43评论（待用户审核）

@rrrexfield @heocean3-cmyk C已核查PR #44的bf78bede提交：认可按当前模态、去重邻接节点>=3判定路口；武汉五路口独立复核返回degree=5、3个way与12个转向一致。建议查询索引暂留A的api目录，C不要求立即迁移。

有一处请A修正：parseCoordinate('',180)及parseCoordinate('   ',90)实际均返回0，空值应在Number之前trim拒绝，并补HTTP空参数回归，合法'0'仍保留。

另外请A/E明确两项边界：等距路口目前随边插入顺序选取，建议确定稳定策略或歧义提示；只有出边的三邻接节点会命中但转向为空，需决定排除还是明确显示无动作。两项属于补充口径，不把它们表述为违反现有degree契约，也不由C自行改shared。节点权限另在#34跟进，nearest不代表公众可通行性已核验。

## 拟发#34评论（待用户审核）

@rrrexfield @HCl2778 感谢A确认PR #42已合入。结合#43的路口查询，C建议下一步按构图阶段统一节点准入：C负责兼容的nodeTags参数、过滤与诊断，以及io运行时接入；请A确认后同步接api/ModalRuntimeRegistry两处构图调用，B消费统一图，不单独按另一套权限规则构图。过滤后nearest/转向索引/Graph一并重建，SQLite失配保留诊断与旧快照。

优先覆盖明确禁止/私有/permit及条件权限，保留foot等模式覆盖优先级，屏障按模式处理、不一律断路；需明确未知语义和缺标签输入的诊断口径。沿用此前扬波门foot=permit反例及替代路回归。请A确认是否接受此兼容输入方案，以及是否将修复单独跟踪；在确认前C没有改A/B实现，也未声称节点权限已修复。

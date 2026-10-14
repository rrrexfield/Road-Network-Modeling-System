# C 第一次作业任务准备

日期：2026-10-14。状态：独立构边、方向兼容与可序列化构边报告完成；49 项全仓测试通过（20 项方向、20 项构边、4 项报告、5 项原有测试）。B 已提供可直接接收 nodes/edges 的接口并在其分支验证；尚未在本分支集成，M1 口径仍需 A/B 确认。

## 1. 当前数据检查

输入：`data/wuhan.json`，169,524,874 字节。顶层字段为 `source_file`、`nodes`、`ways`、`relations`。

| 项目 | 数量 |
|---|---:|
| 原始节点 | 1,924,603 |
| 原始 way | 183,056 |
| relations | 1,471 |
| 含 highway 的 way | 69,382 |
| 道路引用的唯一节点 | 627,900 |
| 道路相邻节点段 | 673,120 |
| 缺失引用节点 / 涉及缺失节点的段 | 0 / 0 |
| 重复节点 ID / 不安全整数节点 ID | 0 / 0 |
| 非有限或超出经纬度范围的节点坐标 | 0 |
| 少于两个节点的道路 / 相邻重复节点段 | 0 / 0 |

上述检查不证明数据已完全正确，尚未检查全部道路 ID、重复标签和重复几何。673,120 是原始相邻节点段数，不是处理单双向规则后的通行边数。

| oneway | 道路数 |
|---|---:|
| 未填写 | 50,733 |
| yes | 17,855 |
| no | 720 |
| -1 | 74 |

`junction=roundabout` 有 74 条，`junction=circular` 有 9 条。包含 footway、steps、cycleway 等类型，另有 construction 821 条、proposed 21 条。保留用于显示不代表允许汽车通行。

真实样例 way ID：未填方向 947969492；正向单行 802095273；显式双向 233591443；反向单行 825842317。

## 2. 工作顺序与边界

1. 已完成：检查现有输入字段、方向标签及基础数据质量。
2. B 已在 Issue #2 提供 Graph(nodes, edges)，直接接收本模块产物；C 独立验证其分支 60 项测试、typecheck、lint 通过。路径几何、ID 生命周期与 M1 口径的确认请求见 `c-m1-integration-issue-draft.md`（待用户审核发布）。
3. C 在 `server/src/topology/` 实现方向判定和相邻节点生成有向边，先用小型测试验证。
4. C 在 `server/src/io/` 完善输入校验和统一格式转换。GeoJSON、自定义格式、SQLite 的实际结构先向数据提供方确认。
5. 接口确认且 B 的代码合入后，装载 Graph，联调路径与拓扑报告。
6. 功能分支提交前更新 CHANGELOG、AI 日志并完成必要检查；外部发布须先给用户审核。

管线：读取文件 → 校验 → 统一节点和道路结构 → 判断方向 → 生成有向边 → 装载 B 的 Graph。

C 负责 io/topology；B 负责 Graph 及图算法；A 负责 shared 契约及 buildTopology → Graph → API 组装。当前形状无需适配层，C 不修改其他成员代码。

## 3. 方向规则草案

参考：https://wiki.openstreetmap.org/wiki/Key:oneway

- 显式 `oneway=yes/true/1`：沿原始节点序列生成边；true 和 1 为兼容输入。
- 显式 `oneway=-1`：逆原始节点序列生成边，保留原始 way 关联。
- 显式 `oneway=no/false/0`：两个方向生成边，覆盖隐含默认；false 和 0 为兼容输入。
- 无显式方向且 `highway=motorway` 或 `junction=roundabout`：默认正向单行。
- 其他普通道路无显式方向：草案默认双向。
- `junction=circular` 不按 roundabout 自动推断方向。
- 未识别、条件式或可变方向标签：当前行为明确为跳过整条道路，不猜测方向，并通过 createTopologyReport 列出道路 ID、标签和排除原因。是否采用此行为作为 M1 最终策略须由 A/B 确认，不能在报告中隐藏这些排除。

motorway_link 无显式方向时当前继续排除并在报告中单独列明，不改为未经确认的默认正向。M1 建议采用全输入道路的拓扑基础图，并明确含步行/施工/规划道路，不称作驾车导航图；汽车演示的过滤范围由 A/B 确认。方向判定不等于完整车辆通行资格判断。相关确认请求已整理为本地 Issue 草稿，未声称团队定案。

## 4. 测试样例设计

统一基础节点 1、2、3；除特殊说明外，道路序列为 [1,2,3]。

| 场景 | 预期 |
|---|---|
| 普通道路无 oneway / oneway=no | 1→2、2→1、2→3、3→2 |
| oneway=yes | 1→2、2→3 |
| oneway=-1 | 2→1、3→2 |
| motorway 无 oneway | 1→2、2→3 |
| roundabout 无 oneway | 原序列方向；闭环由输入首尾节点表达 |
| motorway 或 roundabout 显式 oneway=no | 双向，显式规则优先 |
| 两条道路 [1,2] 和 [2,3] | 共用节点 2，不复制路口节点 |
| 几何交叉但没有共享节点 ID | 不凭几何交叉新增连接 |
| [1,缺失节点,3,4] | 报告缺失；不得生成 1→3，可保留有效 3↔4 |
| [1,1,2] | 报告或跳过退化段，不生成 1→1 |
| 少于两个节点 / 非法坐标 | 输出可定位的异常，不生成伪边 |
| 两条不同 way 连接同一对节点 | 保留各自来源，不能仅按端点去重 |
| 未识别 oneway | 可识别的诊断结果，具体拒绝或跳过策略待确认 |

方向判定部分已有 20 项测试，支持 yes/true/1、no/false/0、-1；条件方向、可变方向和未识别值返回 unsupported。motorway_link 无显式方向时排除并可在报告中定位。

`buildTopology()` 已实现按原始相邻段生成有向边，并保留道路属性；缺失或非法节点不跨缺口连接，退化段跳过并报告，未知方向跳过整条道路并报告。节点连接、边方向与来源、ID 唯一和稳定顺序已有构边测试；实际 Graph 断言在 B 接口确认后补充。此模块尚未接入 loader，不改变现有运行链路。

### 桥隧、高架与测试边界

- 几何交叉或坐标重合不会创建连接；节点 ID 相同才共享拓扑节点。
- 保留原始 `bridge`、`tunnel`、`layer` 及其他标签，边通过 `wayId` 查道路属性。桥隧本身不决定单行。
- 不按 layer 机械拆开共享节点，因此匝道与结构端点的真实连接可保留。
- 20 项构边测试涵盖桥隧跨越地面道路、重合坐标不同节点、跨层匝道、方向与别名构边、缺失/非法节点、退化段、来源关联、平行道路、输入不变性、中间节点保留和边 ID 生命周期。
- 数据自身若错误共用节点，本模块会保留该连接；尚未自动诊断结构属性矛盾或修复错误 OSM 拓扑。无节点 ID 的 GeoJSON 交叉点构建也未实现。
- 标签参考：[bridge](https://wiki.openstreetmap.org/wiki/Key:bridge)、[tunnel](https://wiki.openstreetmap.org/wiki/Key:tunnel)、[layer](https://wiki.openstreetmap.org/wiki/Key:layer)。

### 武汉全量运行结果（2026-10-14）

69,382 条道路生成 1,194,218 条有向边，包含 627,898 个有效边端点。保留的道路中有 bridge 非 no 标签 6,644 条、tunnel 非 no 标签 954 条。这些是标签数量，不是独立桥梁或隧道设施数量。

发现 1 条未支持方向道路（wayId=1425515305、motorway_link 无 oneway），跳过并记录；未发现边端点缺失、边来源缺失或节点自环。此结果证明构边可在该数据上运行且满足所检查的不变量，不证明全量通行语义、最短路径或性能达标。

### 报告与路径几何

`createTopologyReport(result)` 输出 JSON 可序列化的计数、异常计数与 `excludedDirectionWays` 明细，并标注 `scope=input-roads-without-mode-filter`。A 集成时必须将该口径和排除列表与 B 的连通性报告一起呈现；目前仅提供数据，未接入 API/UI。

评审修复后全量重跑通过：retainedWayCount=69,382、builtWayCount=69,381、nodeCount=627,898、edgeCount=1,194,218；报告排除列表包含 wayId=1425515305，reason=missing-motorway-link-direction。端点/来源缺失及节点自环计数为 0。49 项测试、三包 typecheck、全仓 lint 和新代码格式检查均通过。

未进行道路链压缩：[1,2,3] 的两段边端点集合包含 1、2、3，节点 2 不会丢失。因此 B 返回的 `nodeIds` 可按顺序查询 `TopologyResult.nodes`，将 [lat,lon] 转成前端 [lon,lat] 生成路径折线。`ways` 只保留属性，不含 nds；本阶段路径几何不依赖重新读取 nds。跨缺失节点的段不在图中，不能补成伪路径。

边 ID 是本次构边顺序生成的局部编号。固定输入和规则时可复现，换排序/过滤/规则则可能变化。路径 edgeIds 只能关联同一个图版本；持久化转向限制和跨会话 ID 策略必须另行定案，不能直接依赖当前编号。

## 5. 现有代码问题

- `io/loader.ts` 仅按原序列生成一条方向边，尚未处理单双向语义。
- main 已通过 PR #6 将 `NetworkMeta.edgeCount` 更名为 `segmentCount`，本分支已 rebase 同步。`meta.segmentCount` 表示方向处理前的原始相邻段数；构边后的边数为 `TopologyResult.edges.length`。Health/WS 的 edgeCount 字段未改名。
- 预处理 `prepare()` 向 `buildEdges()` 传入道路引用节点集合，而非实际存在节点集合；本次数据无缺失引用，因此未触发问题，但其他输入可能让计数不准确。该脚本由 A 维护，先记录需求，不在 C 范围修改。
- loader 生成显示几何时直接跳过缺失节点，其他输入可能出现跨缺口连线；C 后续需要明确显示与计算数据的缺失处理。

不在本阶段实现转向限制、多模态、压缩、动态权重、OSM XML 导入。

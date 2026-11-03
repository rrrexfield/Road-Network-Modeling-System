# C：转换点接驳证据与交接（Issue #34）

2026-11-03，分支 `feature/transfer-attachments`，基于 main `6852326`。本批未发布、未合并；已合并的SQLite交付见 `c-sqlite-ready.md`。原stash保留。

## 已完成与调用方式

公开入口均经 `server/src/io/index.ts` 或 `server/src/topology/index.ts`：

```ts
const data = extractTransferPoints(rawOsm);
const networks = { car: carTopology.nodes, walk: walkTopology.nodes };
const candidates = matchTransferConnections(data, networks, 100);
const entrances = inspectTransferEntrances(data, rawOsm, networks);
```

- 提取补识别 `railway=subway_entrance`，kind=subway、只属于walk，不新增rail。同站多个出口与站中心分别保留，不按名字删除。
- 匹配返回逐模式nodeId、球面距离、证据与异常；网格缩小范围后用球面距离筛选，支持经度边界、极区回退扫描，不修改图。节点表是同次构图原始 `[lat,lon]`，展示位置为 `[lon,lat]`。
- 区域入口检查只取原way边界的显式entrance或共享节点，按模式检查坐标及准入，全部 `requiresReview=true`。明确入口未入图时保留空modes并诊断。
- 清理OSM禁转导入重复conditional判断；新增foot回归，保证一般机动车conditional不遮蔽foot专用禁转。

这些是服务端分析接口，不是新增REST/shared DTO，也没有建立可搜索的转换边。缺少实际入口证据时，不用展示中心/最近距离跨越围墙、分层道路或地下空间。

## 匹配与异常规则

| 结果 | 含义与处理 |
|---|---|
| shared-osm-node | ID与坐标一致，只有共享拓扑证据，仍需核实换乘许可 |
| nearby-candidate | 半径内唯一最近点；同坐标不同ID也只是候选 |
| entrance-required | way展示中心不能当入口，改查原始边界 |
| no-node-within-radius | 超出候选阈值，不自动扩大阈值 |
| ambiguous-nearest | 1e-6米容差内并列最近，不任意选取 |
| source-geometry-changed | 同ID坐标变化，不沿用旧连接 |
| missing-source / mode-not-loaded | 来源或模式图缺失 |
| entrance-permission-or-barrier-unresolved | 屏障、禁入、条件权限或入口类型未决，拒绝采用 |
| mode-access-unresolved | 某模式权限不明/不允许，不加入该模式 |
| entrance-not-on-mode-graph | 入口不在某模式图中，不伪造连通 |
| no-supported-entrance-evidence | 无支持入口证据，等待补充/人工核验 |

半径允许0–1000米；本批实跑固定 **100米**，是待A/B评审的候选策略，不能与#34的200米示例混用统计。节点表只含有效道路边端点；节点距离不能判定入边/出边方向，B采用连接前须检查该模式的有向边及真实接驳许可。不同模式edgeId不能复用。点型候选输入不含完整屏障/准入标签，不能因此认定物理通行；区域检查也只检查边界节点，不能代替整段现场核验。

## 武汉全量实测

源 `data/wuhan.json`，SHA-256：`0d23735b19f5d7f311b7f2c5f243620860970fbb86f9e4853d52b6a904214a3d`。只读原文件，未覆盖已有派生文件。

| 项目 | 结果 |
|---|---:|
| 标记总数 | 2930：bus1232 / subway659 / parking1040 |
| 新识别地铁出入口 | 334，其中86共享walk源节点 |
| 提取排除诊断 | 43 |
| 100米点-模式匹配 | 3050：共享598 / 近邻2452 |
| 半径内无节点 | 103个点-模式组合 |
| way代表点要求入口 | 1040个设施 |
| 区域入口候选 | 213个设施共561个：显式12 / 共享边界549 |
| 无支持入口证据 | 827个设施 |
| 入口未在某模式图 | 379项 |
| 屏障/权限未决 | 31项 |
| 特定模式权限未决 | 2项 |

统计单位不同且有重叠，不能相加当设施总数。旧main的2596是补地铁出入口之前的结果，合并后A在#33重建派生文件才能得到2930，重启旧文件不会更新。

本机验证脚本与汇总：忽略目录 `data/derived/transfer-audit.ts` / `transfer-audit-summary.json`，本机可执行 `node --max-old-space-size=6144 --import tsx data/derived/transfer-audit.ts`。全量方法：读取原数据提取转换点、由已有道路数据独立构建四模式、100米匹配、原边界入口检查、对候选停车节点与地铁出入口逐段Dijkstra。该本机脚本不随分支交付；同伴可重跑下列固定片段测试，无需大数据。

## 真实片段与验证边界

`server/src/topology/fixtures/wuhan-transfer-candidate.json` 保留35个原始节点、5条way和源哈希；`wuhan-transfer-candidate.test.ts` 经模块公开入口验证：

- 汽车起点13707011476 → 停车区域1499199682的共享边界节点13707011477：约24.031米。
- 同一边界节点 → 地铁出入口5227950237：步行约195.993米。
- car/walk分别用既有Graph/Dijkstra验证有向可达，不把仅步行的地铁入口放入汽车图。
- 删除接入地铁入口的步行边后必须不可达，不通过直线近邻补边。

**限制**：停车设施是multi-storey，选中节点没有显式entrance标签，仅有shared-boundary-node证据，仍需核验真实入口/楼层，不能作为实景换乘验收。此前只筛“显式entrance且car/walk共享、地铁出入口1500米内”没有找到样例；共享边界样例仅证明路网分段可达，不是放宽通行许可。本例无轨道乘车段、跨模态搜索、换乘罚时，也未验证B的禁转搜索。

运行 `npm test`：全仓232项通过（main212项，本分支新增20项）；`npm run typecheck`（shared/server/web）、`npm run lint`、`npm run build`全部通过。专项覆盖球面半径/经度边界/极区、并列最近及近等距顺序无关性、同坐标不同ID、几何变化、中心拒绝吸附、屏障及权限、入口未入图、地铁入口提取、真实片段正负例。前端构建存在既有大包体积警告，不影响构建成功。

## 成本与剩余依赖

建议统一用秒：各模式边长/相应速度 + 实际接驳步行时间 + 换乘等待/停车罚时。不能把当前Dijkstra的米数与秒相加。速度、罚时、允许采用的连接证据待A/B/D确认，本分支不虚构默认等待时间。bus目前仅表示准入道路，缺少线路/班次/停站约束，不承诺公交线路级正确性。

后续：A冻结多段路径/转换结构及公交语义 → 人工核验入口 → B按核验连接实现跨模式状态/成本搜索 → A注册接口、重建数据 → E接线并联合验收。C提供候选、诊断和固定片段，继续配合；#34不能关闭。

GitHub对接文字见 `c-transfer-handoff-draft.md`，按用户约定先审核再发送。

# Sprint 2：独立数据审计与固定回归（2026-11-07）

分支test/transfer-tag-audit，基于main9d86496，与待评审PR #59分开。结论：Sprint 2主体功能已有对应交付，C基础模块已合并；仍有已反馈集成缺陷与近似模型边界，不能将issue全部关闭理解为所有问题已解决。本报告不替教师评分，也不修改A的验收清单。

## 1. 设施标签覆盖审计

输入原始data/wuhan.json，SHA-256=0d23735b19f5d7f311b7f2c5f243620860970fbb86f9e4853d52b6a904214a3d。运行audit-transfer-tags.ts重新提取设施，按sourceType/sourceId回查原始标签，并与派生nodeTags逐项对照；没有根据当前Map缺项猜测原始标签为空。

| 指标 | 结果 |
|---|---:|
| 当前原始数据提取转换点 | 2930：bus1231/subway659/parking1040 |
| 点型源设施 | 1890 |
| way型源设施 | 1040 |
| 派生道路nodeTags条目 | 6995 |
| 点型源设施在道路标签表中有条目 | 372 |
| 点型源设施缺少该表条目 | 1518，原始标签均非空 |
| 已保留条目与原始标签不一致 | 0 |
| 点型设施带权限/模式/屏障/层级相关标签 | 1092 |
| 上述相关标签在道路表中缺失 | 813：809个bus=yes、4个layer |
| 缺项设施中明确no/private/permit权限标签 | 本次未检出 |
| 缺项设施中barrier或conditional标签 | 本次未检出 |
| way型设施带上述相关标签 | 161，不属于节点标签表覆盖对象 |

“相关标签”包括公交准入与层级，不等于危险/禁行。零明确限制只是当前快照与本次键值筛选结果，不能证明现实公众通行。派生nodeTags按道路节点提取，天然不能作为全部图外设施的完整标签来源。PR #59的undefined判定是拒绝把数据缺失当作已检查；其调用方应先确定完整设施标签来源。

### 本机旧文件与重新生成结果

本机wuhan-sprint2.json为11月3日历史文件，只有2596个点，缺334个后来补识别的地铁出入口；这不是A机器上重建结果失效的证据。本地默认wuhan-roads.json当时不存在，原dev脚本会在缺失时自动生成，未将其当作新代码缺陷。

本轮固定回归在新目录c-sprint2-check-qRMDuQ生成derived.json；与原始提取均为2930点，missingFromDerived=0、extraInDerived=0。旧文件和实际禁转数据库未改写，未把审计目录自动替换成生产数据。

## 2. 可重复执行的命令

两条命令均在C的server/src/io中，不修改A的scripts/或根配置，不注册REST、不经io/index.ts导出，因此不会在服务启动时自动执行。

```powershell
$env:TEMP='D:\GIS算法设计与分析\Git\.tmp-c-topology'
$env:TMP=$env:TEMP
node --max-old-space-size=6144 --import tsx server/src/io/check-sprint2-data.ts data/wuhan.json data/derived
```

check-sprint2-data.ts每次在指定父目录下新建唯一目录，生成派生文件、私人SQLite及report.json；校验固定源哈希，输入快照变化时要求人工更新预期，不静默更改标准。不接收用户现有数据库路径，不自动删除运行产物。

检查项：预处理6995条nodeTags/353条relations/2930点；四模态过滤后边数；扬波门在各模式不入图；五路口12个动作；保存一条新增手动禁转（保留该路口已有禁转），重建运行时后恢复且restoreIssues=0。本次执行全部通过，结果不是网页、近似换乘或实景入口验收。

拿上述命令输出的derivedFile运行标签审计，输出报告必须为尚不存在的新文件：

```powershell
node --max-old-space-size=6144 --import tsx server/src/io/audit-transfer-tags.ts data/wuhan.json data/derived/c-sprint2-check-qRMDuQ/derived.json data/derived/transfer-tag-coverage-new.json
```

示例目录需替换为本次生成目录。命令拒绝输出覆盖输入，已有输出也不覆盖；报告保存完整设施ID及标签覆盖行，控制台只打印汇总。本次401项全仓测试、完整typecheck及lint通过；新增1项CLI回归验证缺设施标签、旧派生漏点、只读输入与覆盖保护。没有修改前端或运行时行为，不重复生产构建。

### 本次固定预期与结果

| 模式 | 节点 | 有向边 | 节点排除诊断 | 删除有向边 |
|---|---:|---:|---:|---:|
| car | 532029 | 986418 | 1465 | 4511 |
| walk | 567423 | 1214979 | 1493 | 5198 |
| bike | 512934 | 995720 | 1357 | 4312 |
| bus | 532501 | 987037 | 1476 | 4545 |

排除诊断包含未知屏障等保守策略，不全是实际禁行；本轮不将这些数字替换为A早期未做节点过滤的基线。脚本401测试基于main400+本次1项；PR #59的16项另在待审分支，故不同分支测试总数不同。

## 3. 审计证据与剩余工作

本机产物均在忽略目录：transfer-tag-coverage-20261107.json（旧派生对照）、transfer-tag-coverage-fresh-20261107.json（新派生对照，约825KB）、c-sprint2-check-qRMDuQ/report.json及其新派生文件/SQLite。不提交大文件或用户数据库。

Sprint 2的转向模型、SQLite、四模式、编辑器、模态显示、分段搜索及设计说明已有交付。继续收尾：PR #59评审；完整设施标签接入及受限设施重新吸附；模态GeoJSON残留受限段；空经纬度校验；近似证据对用户的说明。前述遗留已反馈，修复后的验收需按实际代码重跑，不以旧issue关闭状态代替。

公交/地铁线路级未建模、近邻换乘非实景核验、等待时间未标定属于当前模型边界，需要在答辩中准确说明。最终AI理解自评由用户填写，演示录屏及真实地图/现场入口核验仍不能由本数据回归替代。本轮未向其他成员发送新消息。

# 节点准入：测试准备（未实施修复）

2026-11-06更新：以下为11月5日准备记录；fix/node-access已实现C侧过滤并将14条案例接入回归，详见c-node-access-ready.md。新增2项夹具基线、21项节点回归及1项SQLite回归，全仓399项通过；A网页运行时仍待接入，不能据此说线上已生效。

2026-11-05，分支test/node-access-fixtures，基于已合并main 769504a。#34的nodeTags兼容输入方案仍待A确认；本分支只有夹具、基线测试和用例计划，不修改生产构图、API或B搜索。

## 已准备的材料

- topology/fixtures/wuhan-permit-gate.json：原始扬波门node1358787382及相邻2节点，way488587938（扬波路）。从原始way的nds下标37至39裁剪，保留sourceRange与原始文件SHA-256；不代表完整停车场至地铁路线，不把节点/道路标签改成合成值。
- topology/fixtures/node-access-scenarios.json：4节点、2道路的合成图；主路1→2→3，绕行1→4→3。绕行道路显式oneway:foot=yes，反向不能靠步行忽略机动车单行的规则意外通行。另有14条待确认的模式准入案例。
- topology/node-access-fixtures.test.ts：2项可执行基线测试。真实片段复现旧调用未传nodeTags时路径穿过permit闸门；合成图验证最短路线、绕行确实更长、反向绕行不可达。没有模拟节点过滤，更没有把当前缺口误当修复完成。

验证命令：Vitest运行上述测试文件，tsc -p server，对上述测试文件运行ESLint。2项测试、server类型检查及专项lint通过；未因仅增加夹具而重复执行全仓构建和HTTP套件。

## 待确认的权限用例

JSON中的proposed为建议结果，不是已冻结的公共契约，也未调用尚不存在的节点准入实现。A确认后将逐项接入修复回归，不能把14条数据记录称作14项已通过测试。

| 用例 | 模式/节点标签 | 建议预期 |
|---|---|---|
| access-no | walk/access=no | 阻止穿越 |
| access-private | car/access=private | 阻止公众穿越 |
| foot-permit | walk/access=yes,foot=permit,barrier=gate | 更具体权限要求许可，不作为公众许可 |
| foot-overrides-general | walk/access=no,foot=yes,barrier=gate | 明确foot许可覆盖一般权限 |
| foot-no-overrides-yes | walk/access=yes,foot=no | 禁止walk |
| motorcar-overrides-motor-vehicle | car/motor_vehicle=no,motorcar=yes | car按具体许可处理 |
| bus-overrides-psv | bus/psv=no,bus=yes | bus按具体许可处理 |
| bike-overrides-vehicle | bike/vehicle=no,bicycle=yes | bike按具体许可处理 |
| cycle-barrier-explicit-foot | walk/barrier=cycle_barrier,foot=yes | 不因自行车屏障误伤明确步行许可 |
| wall-even-with-foot-yes | walk/barrier=wall,foot=yes | 矛盾证据，诊断未决而非直接放行 |
| gate-no-access-evidence | walk/barrier=gate | 通行语义未决，策略待确认 |
| conditional-foot | walk/foot=yes且有foot:conditional | 未支持条件权限须诊断，不忽略 |
| unknown-value | walk/foot=未知值 | 未决诊断，不当yes |
| motor-condition-with-explicit-foot | walk/foot=yes且仅motor_vehicle:conditional | 不把机动车条件限制套给walk |

无标签节点和未传nodeTags是两回事：完整标签输入下某节点无标签，不应被简单解释为“所有节点禁行”；旧三参数调用未提供标签时，不得声称已校验权限。二者的报告字段及默认策略仍需A确认。

## 实施时必须补的集成回归

1. 主路中间节点2不可通行，无绕行时1→3不可达，且不生成1→3跨缺口边。
2. 节点2不可通行、有绕行时只能得到1→4→3，路径长度必须比原始短路大。
3. 上述绕行方向反转时不可达，不为了绕开闸门破坏原始单向规则。
4. 起点或终点受限时不得自动吸附到另一侧；返回形态与A/B既有不可达语义对齐。
5. 路口度数/nearest索引随受限边删除重建；从3邻接降为2后不能保留旧路口命中。
6. 禁转表只引用过滤后的当前模式边集，不能复用旧edgeId或其他模式edgeId。
7. SQLite先保存一组规则，再过滤改变图：仍可匹配的规则按way段端点/几何恢复；受限边失配进入restoreIssues并禁止覆盖旧快照。去掉过滤后重启，旧快照仍在。测试数据库与临时文件放D盘。
8. io/createTurnRuntime传入nodeTags；A运行时的两处构图调用也传同一输入，nearest、转向编辑和B搜索不能各自使用不同准入结果。

以上8组是实施后的验收任务，目前未执行。没有修改shared、引入新REST契约或替A决定HTTP状态；B的禁转搜索同样未被改写。

## 后续

A确认nodeTags输入形式、模式覆盖/屏障语义及旧调用诊断后，将14条权限案例和8组集成任务转成针对真实实现的断言；避免先写一套测试侧过滤器再与它自己比较。发布或合并前补全全仓typecheck/lint/tests/build，并确认数据规模下耗时/内存。当前材料先留本地，未经用户审核不发送新评论。

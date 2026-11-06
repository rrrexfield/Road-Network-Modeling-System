# C节点准入修复交接（2026-11-06，待审核）

分支fix/node-access，基于main70f7389；本次只改C的topology/io及配套文档、测试。A/B/E实现与shared不变，尚未推送/创建PR。用户已授权C继续修复；A尚未回复具体策略，以下规则作为本分支可评审实现，不冒称已获全员认可。

## 接口

```ts
const result = buildModalTopology(network.nodes, network.ways, mode, network.nodeTags);
result.nodeAccess; // { checked, excludedNodes: [{ nodeId, reason }], excludedEdgeCount }
```

NodeTags/NodeAccessReport类型经topology/index.ts公开。第四参数兼容旧调用；不传时保留原图并checked=false，不能宣称节点权限已检查。传入完整提取的稀疏标签表时checked=true，表中无某节点表示无标签，不等同于标签输入整体缺失。checked仅说明执行本规则，不表示现实通行或数据完整性已核验。

C的io/createTurnRuntime已传network.nodeTags，因此其返回的modal.topology和service使用同一份过滤结果。**A的api/ModalRuntimeRegistry仍有两处三参数构图调用，网页尚未启用本修复**，需A改为上述四参数并保留/记录nodeAccess诊断。A/B随后基于过滤后的图重建Graph、转向索引、nearest索引及换乘连接缓存；不沿用旧索引。GeoJSON道路代表属性仍为原始way，不能从原始way几何推断受限节点已经可通行。

## 策略与限制

- 模式优先级与way准入共用：car=motorcar→motor_vehicle→vehicle→access，bus=bus→psv→motor_vehicle→vehicle→access，bike=bicycle→vehicle→access，walk=foot→access。
- 首个显式值yes/designated/permissive可通行；no/private明确排除；permit要求许可，普通公众模型排除；其他未支持值（含customers/destination）以unsupported诊断并保守排除。foot=yes可覆盖access=no，机动车条件标签不套给walk。
- 相关模式任一级conditional、forward/backward权限未计算时段/方向，保守排除；barrier:conditional同样诊断。即使更具体静态许可存在，也不忽略相关一般条件标签，这是保守选择，待A评审。
- barrier=no不额外限制；gate/lift_gate/swing_gate/cycle_barrier/bollard/block/stile/turnstile/kissing_gate/sally_port/chain/toll_booth/entrance需要上述显式准入许可。墙、其他未知屏障即使同时标foot=yes仍作为未决排除，不能据矛盾标签直接穿墙。
- **无显式许可的闸门也会保守排除，并非判定这些闸门现实均禁止公众通行**。本规则可能误排可通行设施，不能把当前策略称为完整OSM权限解释或实景导航认证。未知屏障、许可模型、条件权限需要后续补证据/语义规则。

过滤在buildTopology之后执行，仅删除受限节点的相邻有向边以及不再有有效边的节点；不跨缺口连线，不改变剩余edgeId/方向，不修改输入nodes、way及原始tags。nodeAccess只诊断原本入图节点；图外标签不会被误计为排除。道路属性表保留原始way，原始/派生大文件未改写。不同模式仍不复用edgeId。

## 验证

399项全仓测试通过，完整shared/server/web typecheck、全仓lint、前端生产build通过（既有大包体积警告）。首次全仓执行因本地缺main已锁定的jsdom31.0.0未完成；在D盘隔离安装并连接本地node_modules后重跑成功，未改package.json/package-lock.json，未把依赖缓存放C盘。

新增24项：2项先前准备的夹具基线、21项节点准入回归（含14条权限矩阵）、1项SQLite运行时过滤/恢复回归。旧三参数基线有意保留以验证兼容性，不代表权限修复已在旧调用中生效。

- 原始扬波门3节点/1way片段提供nodeTags后，foot=permit产生node-permit-required，两个方向均不再穿过；未传标签仍为checked=false。
- 主路受限后只能沿真实1→4→3单向绕行，反向不可达，不补1→3虚构段；起终点受限不会留作图节点。
- 明确模式许可覆盖一般禁入；条件、方向、未知权限与屏障分别诊断；输入和原始道路标签不变，剩余边ID保持。
- 转向索引只读剩余边集；SQLite先保存两条禁转，过滤后1条失配、另一条恢复，setTurns拒绝覆盖旧库；恢复原标签再启动，原两条规则仍能恢复。

## 武汉全量实测

读取已保留6995条道路nodeTags的本机wuhan-sprint2.json（原始道路与之前基线一致）；不写该派生文件或原始wuhan.json。本机脚本data/derived/node-access-full-audit.ts及汇总node-access-full-audit.json均被Git忽略。

| 模式 | 剩余节点 | 剩余有向边 | 排除节点诊断项 | 删除有向边 |
|---|---:|---:|---:|---:|
| car | 532029 | 986418 | 1465 | 4511 |
| walk | 567423 | 1214979 | 1493 | 5198 |
| bike | 512934 | 995720 | 1357 | 4312 |
| bus | 532501 | 987037 | 1476 | 4545 |

扬波门四模式都排除：walk/car/bus为permit要求，bike为private；步行图1493项中717项node-access-denied、47项node-permit-required，其余729项为未决/未支持策略导致的保守排除。边数减少不全是“确定的脏数据”或“确定不可通行”；孤立节点清理会使节点减少数大于直接诊断项数。单模式本机构图约1.9–2.7秒，只是本次实测，不是性能保证，未构造四份完整SQLite运行时常驻。

## 合并与验收边界

请A评审保守屏障/条件规则并接两处API调用；B使用同一运行时图，不按另一套规则单独构图。实际网页路径、最近路口与跨模态连边仍需接线后的联合回归，不据本分支宣布已修复线上功能。空坐标校验及近似换乘证据下发仍属A/E另项，本分支未混入修复。

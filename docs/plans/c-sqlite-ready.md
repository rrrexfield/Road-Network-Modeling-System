# 2026-11-03 · SQLite 可交接入口与数据修复

## 已核实的问题

最新main为39e1531：prepare-data只保存道路节点坐标，不保存节点tags/relations；loader也没有相关字段，OSM禁转导入缺失；createTopologyReport没有结构属性诊断。三项确实存在，但截图中的“102条全转成有效规则”和“5个冲突节点”不能不经验证直接成立。

原始武汉含102条restriction：当前基础图87条可解析为89个被禁边对；11条成员不完整或不支持，4条没有匹配边对。原始数据存在缺via、缺to或多个from等记录，禁止猜测补造。每个失败都保留relationId和原因，导入结果另有restrictionId→relationId溯源。

新的结构诊断检查“不同道路内部共享节点”的bridge/tunnel/layer差异，避免普通桥端衔接误报。武汉当前得到26个疑点；这不是26个已确认错误，也不等于截图所称5个。输出每个nodeId及参与way的原属性，不自动断边。

## 数据生产与兼容

prepare-data新增nodeTags、transferPoints、relations（restriction/public_transport/route）字段，保留路外POI的提取结果而不把POI强塞进计算图。原始段计数使用实际存在节点集，修复缺失节点时计数不准确的问题。

loader保留扩展字段，旧文件返回dataWarnings；createTurnRuntime遇到旧文件会明确要求重新prepare:data，不假装有完整Sprint2数据。现有旧文件不会被本次验证覆盖。

脚本属于A目录，本修复按用户明确要求提供，提交/合并仍需A按CODEOWNERS评审；未改A的REST路由、B搜索或E页面。

## 给A/B直接调用

```ts
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createTurnRuntime } from './io/index.js';

const runtime = createTurnRuntime(
  pathToFileURL(resolve('data/derived/wuhan-sprint2.json')),
  {
    databasePath: resolve('data/derived/wuhan-turns.sqlite'),
    dataset: 'wuhan-current-source',
    mode: 'car',
  },
);

// API GET：按冻结契约返回全部动作；OSM来源为true。
const turns = runtime.service.getTurns(nodeId);

// API PUT：传入已通过schema校验的请求；内部校验边对并先写SQLite再更新内存。
const response = runtime.service.setTurns(nodeId, request);

// B搜索：该运行时的modal.topology与Graph必须来自相同模式/版本。
const forbidden = runtime.service.isForbidden(viaNode, inEdge, outEdge);
```

上面nodeId/request等由调用方提供，不是复制即可运行的无参数脚本。A负责把方法挂到已有GET/PUT路由，B负责搜索时调用；C未越界修改这些目录。

返回network（含POI/关系）、modal（含模式图/准入排除）、service。数据库父目录由调用方创建；dataset内部自动追加mode，各模式不混存。

## 保存和恢复保证

- 首次启动按关系导入OSM禁转；有SQLite快照后以快照为准，保留仍匹配的OSM来源。
- setTurns复制和校验完整请求，事务写盘成功才同步内存；锁冲突、非法请求等失败时旧内存与旧快照不变。
- 显式空集合/清空也保存“已有快照”标记；重启不会重新启用用户清除的OSM规则。
- 恢复按稳定way/节点端点与原始几何重新匹配edgeID；恢复有失配时提供restoreIssues并禁止继续覆盖旧快照，须先处理数据变化。
- 规则来源从同一数据集的relations重新识别；重启时不能省略原始关系输入。createTurnRuntime统一完成该步骤。
- 使用SQLite文件版本1，追加dataset存在性表兼容之前有数据的快照。旧开发版从未记录过“空快照”存在性，无法追溯该历史状态，必要时重新保存确认。

## 本地可用产物与限制

新的data/derived/wuhan-sprint2.json、独立wuhan-car-turns-demo.sqlite用于本次验证，均在D盘、被gitignore，不提交。演示库与正式用户库分开。旧wuhan-roads.json未覆盖，A切换入口或重新预处理后才能在网页看到变化。

Node24.20当前可用；旧22.11可能需要--experimental-sqlite，A需确认运行基线。真实HTTP注册/页面联调尚未完成，不能把可调用SQLite门面宣称为线上网页已接通。

## 验证

武汉汽车模式实测：读取新派生文件，createTurnRuntime导入72条禁转边对，32条关系诊断；保存后新建运行时恢复，restoreIssues=0，示例relation对应的禁左仍有效。汽车模式比全道路图排除更多道路，故不可用“89条全道路禁转”作为汽车模式期望值。新文件保留6995个道路节点标签记录、353条所选关系与2596个转换点。

当前全仓212项测试通过，shared/server类型检查及全仓ESLint通过。新增覆盖POI/关系保留、OSM禁转与only_*展开、例外/异常关系、来源标记、清空重启、磁盘锁失败回滚、edgeID重排、旧派生数据拒绝和结构报告。

后续换乘候选分支的未提交工作已保存在git stash（描述“保存换乘候选后续工作，隔离数据与SQLite修复”），未丢失、不混入当前修复分支。

# D · Sprint 3 交付:拥堵系数与事件影响(时间槽权重)+ 可达性分析(等时圈)

> 对应 issue #65(A 指派)、立项文档 §4.3 Sprint 3「动态权重模型:等级系数 × 限速 × 拥堵系数(时间槽函数模拟)」与「统计分析:……可达性(等时圈)」。
> 分支 `feature/d-sprint3-traffic-accessibility`,基于 main `f9bfe03`。只改 D 目录(`server/src/weights/`、`web/src/panels/stats/`、`web/src/panels/weight/`)与 D 负责的文档。

---

## 1. 拥堵系数与事件影响(`server/src/weights/traffic.ts`)

### 1.1 合成顺序(钉死,A 冻结契约时引用)

```
基础速度 v₀  = (等级覆盖限速 ?? 模态默认限速) × 全局速度系数 speedFactor
有效速度 v   = v₀ ÷ 拥堵系数 × 事件降速乘子
通行时间 t   = 里程 ÷ v  =  基础时间 × 拥堵系数 ÷ 事件乘子
封闭事件     → Infinity(不可通行,对 time 与 distance 口径均生效)
```

- **拥堵系数乘在时间上**:`1 = 不拥堵,1.85 = 慢 85%,0.85 = 畅通快 15%`——常识表达"比平时慢多少";
- **事件降速乘子乘在速度上**:`0.4 = 剩余 40% 通行能力`——常识表达"还剩几成";
- **distance 口径不受拥堵与事故降速影响**(里程与时间无关),但封闭事件同样生效(封闭是"不可通行"而非"变慢");
- 与既有口径一致:`Infinity` 是本仓库既定的"不可通行"表示(`speed.ts` 速度非正 → Infinity);**可通行边**的返回值满足 `EdgeWeightFn` 前置条件(≥ 0 且有限),单测覆盖。

### 1.2 时间槽模型(确定性,可复现)

- 槽长 `slotMinutes`(默认 30 分钟,一天 48 槽),槽内系数恒定 = **锚点曲线在槽中点的线性插值** × 等级敏感度——同一槽内任意两次查询逐位相同,答辩可当场复现;
- 默认日曲线为显式锚点表(早高峰 1.7–1.85 / 晚高峰 1.75–1.8 / 平峰 1.1–1.15 / 夜间 0.85–0.9),数值为演示用常识估计(非实测标定),`GET /api/weights/traffic` 全量下发;
- 等级敏感度(立项文档"等级系数"的落点):主干路 1.0–1.05,支路 0.7–0.9,巷道 0.5–0.6——拥堵集中在干路;
- 配置覆盖顺序:等级覆盖限速 > 模态默认表(既有)→ ÷ 拥堵系数 → × 事件乘子(新增,乘在最外层)。

### 1.3 事件模型(确定性模拟,不接外部实时数据源)

- `TrafficEvent { wayIds, kind: 'closure'|'incident', speedFactor?, activeHours? }`,按 **way 粒度**(与编辑器"选一条路设事件"一致);
- 合成规则:**任一 closure 命中即不可通行**;多个 incident 按乘子**连乘**;`activeHours: [start, end)` 控制生效钟点区间(缺省全天);
- 事件场景由组装层经插件选项 `WeightRoutesOptions.events` 传入(A 一行接线);查询串 `events=off` 按次关闭。

### 1.4 接入路径(收口,不在两条链路各解析一遍)

- 权重参数:`parseWeightProfileParams`(既有,`/api/path` 与 `/api/stats` 共用)不变;
- 交通参数:新增 `parseTrafficParams(query, presetEvents?)` 同在 `routes.ts` 收口——`hour=8.5` 启用拥堵(缺省不启用,与 Sprint 2 零差异),`congestion=off` 只关拥堵,`events=off` 只关事件;
- 边权:`createModeEdgeWeight(context, mode, profile?, traffic?)` 增加可选第 4 参,**缺省时与 Sprint 2 行为逐位一致**(单测断言等值);
- `/api/stats`:拥堵只作用于时间口径(totalTravelSeconds / averageSpeedKmh),**事件不计入统计**——统计描述路网固有属性,封闭是瞬时状态,把封闭边从里程剔除会让 totalLengthMeters 随一次事故波动。

---

## 2. 可达性分析(等时圈,`server/src/weights/accessibility.ts`)

### 2.1 口径(答辩抽问点,实现内已写明理由)

1. **按边统计里程,不按 way**——way 可横跨可达与不可达区域,按 way 整条计入会系统性高估;边是最小几何单元,与 `/api/stats` 里程统计口径一致;
2. **边计入条件 = 两端点都在预算内**——只有起点端可达时另一半未知,两端可达是"整条边可在预算内通过"的保守近似,不高估;
3. **搜索 = 限界 Dijkstra(预算早停)**——与 B 的全路径 Dijkstra 职责不同(不需要目标与路径还原),堆顶距离超预算即停;算法自写,不引第三方库;
4. **时间权重与 /api/path 完全同源**:`createModeEdgeWeight`(模态 + 配置 + 拥堵 + 事件),等时圈与路径时间不打架。

### 2.2 端点与响应

- `GET /api/accessibility?origin=<nodeId>&budget=<分钟,默认15,上限120>&mode=car|walk|bike|bus&hour=&congestion=&events=`(随 `registerWeightRoutes` 注册,**A 无需额外接线**);
- 响应:`AccessibilityReport`(originNode / budgetSeconds / mode / reachableNodeCount / reachableEdgeCount / reachableLengthMeters / byHighway / truncated / profile / traffic + notes 口径说明);
- origin 缺失 → 400;起点不在坐标表 → 404;结果按参数缓存(上限 16)。

### 2.3 shared/ 契约字段草案(提交 A 冻结,A 冻结前本类型留在 D 模块)

```ts
// 建议加入 shared/src/index.ts(A 冻结时定夺命名与注释):
export interface AccessibilityByHighway {
  highway: string;
  edgeCount: number;
  lengthMeters: number;
  lengthShare: number;
}
export interface AccessibilityReport {
  originNode: number;
  budgetSeconds: number;
  mode: TravelMode;
  reachableNodeCount: number;
  reachableEdgeCount: number;
  reachableLengthMeters: number;
  byHighway: AccessibilityByHighway[];   // 按里程降序
  truncated: boolean;
}
export interface WeightProfileResponseExtensions {  // 或并入既有 WeightProfileResponse 的兄弟接口
  congestion: { slotMinutes: number; curve: [number, number][]; highwaySensitivity: Record<string, number> };
}
```

A 接线项(见 issue [D → A]):
1. `server/src/index.ts` 组装 `registerWeightRoutes` 时传 `events`(预置事件场景,可先传空);
2. `/api/path` 的 mode 分支透传 `parseTrafficParams(query, events)` 结果为 `createModeEdgeWeight` 第 4 参(缺省不传零变化);
3. 冻结上述契约后把 `AccessibilityReport` 移入 shared、D 改为 re-export。

---

## 3. 前端(D 目录内,主界面接线待 A/E)

- **权重配置面板**:新增"时段模拟"区——启用开关 + 0–24h 滑杆(0.5h 步进,与 30 分钟槽对齐)+ 拥堵/事件两个子开关;`onChange(profile, traffic?)` 第二参数为增量(旧调用方不感知),`getTraffic()` 供接线层取查询串参数;
- **统计面板新增可达性卡片**(`accessibility-card.ts`):起点 id 输入 + 预算滑杆(5–60 分钟)+ 模态下拉,展示可达节点/里程/边数 KPI 与分等级可达里程条形图;接口未就绪显示占位态,不以空数据冒充结果;
- demo 页(`/src/panels/stats/demo.html`)已端到端接线;主界面挂载与 E 的着色/动画(issue #66)由 A/E 接线,D 提供的查询参数约定:`hour` / `congestion` / `events`。

---

## 4. 验收对照(issue #65 清单)

| 验收项 | 状态 | 证据 |
|---|---|---|
| 时间槽行为/配置覆盖/合成顺序/前置条件单测 | ✅ | `traffic.test.ts`(20 项)、`mode-weight.test.ts` 增 10 项、`routes.test.ts` 增 7 项、`accessibility.test.ts` 9 项 |
| 同组输入两次运行一致 | ✅ | 单测逐位断言(toBe/toEqual):拥堵权重、等时圈、/api/stats?hour |
| 配置拥堵/事件后时间口径可见变化 | ✅(口径推导+路由级断言) | 默认曲线 8:30 槽 × primary 敏感度 1.05 → 拥堵系数 **1.9425**,通行时间 +94.25%;`routes.test.ts` 断言 `hour=8.5` 的 totalTravelSeconds > 基线且 totalLengthMeters 不变 |
| 武汉实测样例(起点/预算/可达节点/里程) | ⏳ 占位 | 真实数据 `data/wuhan.json` 不入库,本机无;`npm run prepare:data` 后执行 `GET /api/accessibility?origin=<节点>&budget=15` 即得,命令与判定标准已写在 issue [D→A],请 A/C 在有数据的机器回填 |
| CHANGELOG / AI日志 / 设计说明 | ✅ | 三处同步,本文档即设计说明 |

---

## 5. 遗留与占位清单

| 项 | 占位/待办 | 责任 |
|---|---|---|
| 默认拥堵曲线数值 | 常识估计非实测标定;标定可后续按武汉分时段车速数据替换(仅改锚点表) | D(数据到位后) |
| 事件场景 | 服务端预置列表由 A 组装传入;暂无 UI 编辑入口(E 可后续按 #66 加) | A / E |
| 武汉实测回填 | 命令已给,数据不入库 | A / C |
| 契约冻结 | 字段草案见 §2.3 | A |
| /api/path 透传 traffic | 一行接线(缺省零变化) | A |
| 主界面挂载可达性卡片 / 时段联动 | demo 页已接线,主界面 main.ts 待接线 | E |

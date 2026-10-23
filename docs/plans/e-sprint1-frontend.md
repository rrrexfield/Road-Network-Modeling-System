# E · Sprint 1 前端交互设计说明

| 项目 | 内容 |
|---|---|
| 角色 | E 前端工程师·交互 |
| 归属目录 | `web/src/map/`、`web/src/panels/property/`、`web/src/panels/editor/`、`web/src/replay/` |
| 本 Sprint 范围 | 路网渲染、点选属性、起终点选路与路径高亮 |

---

## 1. 模块划分

```
web/src/
├── map/                      ← E
│   ├── basemap.ts            底图可用性探测 + 无网降级样式
│   ├── roads-layer.ts        路网 deck.gl 图层工厂
│   ├── path-selection.ts     起终点选点 + 路径高亮
│   └── index.ts              公开入口
├── panels/property/          ← E（PR #19）
│   ├── property-view-model.ts  纯函数：GeoJSON → 视图模型
│   ├── property-panel.ts       DOM 渲染
│   └── index.ts                公开入口
├── panels/stats|weight/      ← D，E 只负责挂载
└── main.ts                   ← A，E 经授权做少量接线
```

跨模块只经 `index.ts` 公开入口引用，与 AGENTS.md 的目录所有权一致。

---

## 2. 关键设计决策

### D1 · 把 `main.ts` 的重复实现抽成 `web/src/map/`

**背景**：Sprint 0 的前端全部写在 `main.ts` 一个文件里。

**决策**：抽出底图管理与路网图层工厂，`main.ts` 只保留编排。

**理由**：后续 Sprint 2 的模态切换、Sprint 4 的 A\* 回放都要往地图上加图层，
集中在一个文件里会持续膨胀且无法独立测试。

**结果**：`basemap.ts` 的 `buildFallbackStyle()` 可以脱离浏览器环境直接用 Node 单测。

---

### D2 · 属性面板用「纯函数视图模型 + DOM 渲染」两层

**决策**：`property-view-model.ts` 只做数据转换，不碰 DOM；`property-panel.ts` 只渲染。

**理由**：
- 本仓库 Vitest 默认 `environment: 'node'`，DOM 测试需额外引入 `jsdom` 依赖（根 `package.json`）；
- 拆开后，最容易出错的部分（字段映射、标签过滤、空值回落）可以用纯 Node 测试覆盖，无需新增依赖。

**代价**：多一个文件。收益是测试零成本。

---

### D3 · 属性渲染一律用 `textContent`，不用 `innerHTML`

**理由**：OSM 标签是外部数据，`textContent` 从根上排除注入问题，也不必再维护 `escapeHtml()`。

**结果**：`property-panel.ts` 中不出现任何 `innerHTML`。

---

### D4 · 起终点选点：坐标吸附放在服务端

**背景**：前端点地图只能拿到经纬度，而路径算法需要节点 id。

**备选方案**：

| 方案 | 做法 | 问题 |
|---|---|---|
| A | 把 62.8 万节点下发给前端，前端自己找最近点 | 传输十几 MB，且前端要做最近点搜索 |
| **B（采用）** | 前端传经纬度，服务端吸附到最近节点 | — |

**决策**：B。`GET /api/path?from=lon,lat&to=lon,lat` 由服务端完成吸附。

**理由**：数据不出服务端；前端逻辑最简；将来换成 G3 的空间索引时，前端一行都不用改。

---

### D5 · 路径渲染用双层 `PathLayer`

**决策**：先画 9px 白色描边，再画 5px 金色主线。

**理由**：单层金色线在密集路网上与「主干道黄色」混淆；加一层描边才有清晰的层次感，
也符合 AGENTS.md 的视觉基线（金色点缀 `#f2c66d`）。

---

### D6 · 选点模式与道路属性弹窗互斥

**决策**：选点激活时，`overlay.onClick` 直接返回，不弹属性面板。

**理由**：一次点击如果既设起点又弹属性框，用户无法判断当前处于哪种模式。

---

### D7 · 右侧面板改为可收起的独立分区

**背景**：统计与权重面板原本在同一条滚动流里，权重配置被挤到最底部。

**决策**：`#side-panels` 改为 flex 列，每个面板包一层 `.side-section`：
标题条固定、内容区各自滚动、点击收起。

**结果**：两块面板平分高度、互不影响；收起一块时另一块自动占满。

---

## 3. 对外接口

### `web/src/map/index.ts`

```ts
export { BASEMAP_STYLE_URL, WUHAN_CENTER, WUHAN_ZOOM,
         isBasemapReachable, buildFallbackStyle } from './basemap.js';
export { createRoadsLayer } from './roads-layer.js';
export { createPathSelection } from './path-selection.js';
```

### `PathSelectionHandle`

```ts
interface PathSelectionHandle {
  element: HTMLElement;
  setActive(active: boolean): void;
  isActive(): boolean;
  clear(): void;
  recompute(): void;
  getLayers(): Layer[];
  dispose(): void;
}
```

### `PropertyPanelHandle`

```ts
interface PropertyPanelHandle {
  element: HTMLElement;
  show(feature: RoadFeature): void;
  hide(): void;
  dispose(): void;
}
```

---

## 4. 状态与竞态处理

| 场景 | 处理 |
|---|---|
| 连续点击两次以上 | 第三次点击重置起点，避免出现多个起终点 |
| 路径未返回时用户清除 | `requestToken` 自增，旧响应回来后被丢弃 |
| 权重目标切换 | 面板 `onChange` 触发 `pathSelection.recompute()` |
| 接口 404（不可达） | 提示「起点与终点之间不可达」，不显示路径 |
| 接口异常 | 提示「路径接口不可用」 |

---

## 5. 验证

| 项 | 方式 |
|---|---|
| 类型 | `npm run typecheck`（三包全绿） |
| 单测 | `basemap.test.ts`、`property-view-model.test.ts`；全仓 136 项 |
| 交互 | `npm run dev` 手工验证：选点/清除/互斥/面板收起 |
| 接口 | `curl /api/path` 实测 9,645.8 m 路径 |

---

## 6. 已知限制与后续

1. 属性面板目前仍是 MapLibre Popup（正式面板在 PR #19），合并后替换；
2. 选点无吸附预览——用户不知道会吸到哪个路口。可在 Sprint 2 加悬停高亮最近节点；
3. 路径高亮只显示一条，多路径对比是 Sprint 4 的内容；
4. `footway` 等非机动车道路也会出现在路网中，模态切换由 Sprint 2 的 `mode` 过滤解决。
/**
 * 统计仪表盘面板:网络规模 KPI + 等级里程分布 / 占比 / 边长分布三张图 + 拓扑指标区。
 * 面板只负责把 NetworkStats 映射到图表选项,DOM 与样式留在本目录。
 */
import {
  CHART_PALETTE,
  autoResize,
  createChart,
  donutOption,
  formatCount,
  formatDuration,
  formatKilometers,
  formatPercent,
  formatSpeed,
  histogramOption,
  horizontalBarOption,
  roundKilometers,
  type ChartInstance,
  type NetworkStats,
} from '../../charts/index.js';
import './stats-panel.css';

/** 面板句柄。 */
export interface StatsPanelHandle {
  element: HTMLElement;
  /** 用一份统计数据刷新面板(可重复调用)。 */
  render(stats: NetworkStats): void;
  /** 标注数据来源,如"实时接口"或"示例数据"。 */
  setSource(label: string, ok: boolean): void;
  dispose(): void;
}

/** 占比环形图最多单独展示的等级数,其余归入"其他"。 */
const DONUT_TOP_N = 7;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createTile(label: string, value: string, hint?: string): HTMLElement {
  const tile = element('div', 'gis-kpi');
  tile.append(element('div', 'gis-kpi__label', label), element('div', 'gis-kpi__value', value));
  if (hint !== undefined) tile.append(element('div', 'gis-kpi__hint', hint));
  return tile;
}

function createChartCard(title: string, hint?: string): { card: HTMLElement; body: HTMLElement } {
  const card = element('figure', 'gis-card');
  const caption = element('figcaption', 'gis-card__caption');
  caption.append(element('span', 'gis-card__title', title));
  if (hint !== undefined) caption.append(element('span', 'gis-card__hint', hint));
  const body = element('div', 'gis-card__body');
  card.append(caption, body);
  return { card, body };
}

/**
 * 创建统计面板。
 * @returns 面板句柄;element 已含初始骨架(未渲染数据时为占位态)。
 */
export function createStatsPanel(): StatsPanelHandle {
  const root = element('section', 'gis-panel gis-stats');

  const head = element('header', 'gis-panel__head');
  head.append(element('h2', 'gis-panel__title', '网络统计'));
  const sourceBadge = element('span', 'gis-badge gis-badge--wait', '尚未加载');
  head.append(sourceBadge);

  const kpis = element('div', 'gis-kpis');
  const charts = element('div', 'gis-grid');
  const lengthCard = createChartCard('等级里程分布', '按 highway 聚合');
  const shareCard = createChartCard('等级里程占比');
  const histogramCard = createChartCard('边长分布');
  charts.append(lengthCard.card, shareCard.card, histogramCard.card);

  const topologyCard = element('section', 'gis-card gis-topology');
  topologyCard.append(element('h3', 'gis-card__title', '拓扑指标'));

  // 口径说明:把当前权重配置与占比口径摊开,避免"数字好看但说不清口径"
  const summaryNote = element('p', 'gis-note gis-note--summary');

  root.append(head, kpis, charts, topologyCard, summaryNote);

  const charts_: Record<'length' | 'share' | 'histogram', ChartInstance> = {
    length: createChart(lengthCard.body),
    share: createChart(shareCard.body),
    histogram: createChart(histogramCard.body),
  };
  const stopResize = [
    autoResize(charts_.length, lengthCard.body),
    autoResize(charts_.share, shareCard.body),
    autoResize(charts_.histogram, histogramCard.body),
  ];

  function renderTopology(stats: NetworkStats): void {
    topologyCard.replaceChildren(element('h3', 'gis-card__title', '拓扑指标'));
    const topology = stats.topology;
    if (topology === null) {
      // B 的图引擎未接入时的占位态:显式说明"未接入",不让零值冒充统计结果
      const placeholder = element('div', 'gis-placeholder');
      placeholder.append(
        element('span', 'gis-badge gis-badge--wait', '待接入'),
        element(
          'p',
          'gis-placeholder__text',
          `连通分量 / 悬挂节点 / 平均度由 B 的图引擎（server/src/graph）提供，` +
            `当前来源标注为 ${stats.topologySource}。接入前本区不显示任何数值。`,
        ),
      );
      topologyCard.append(placeholder);
      return;
    }
    const grid = element('div', 'gis-kpis gis-kpis--compact');
    grid.append(
      createTile('连通分量', formatCount(topology.connectedComponentCount), '弱连通'),
      createTile('最大分量', formatCount(topology.largestComponentSize), '节点数'),
      createTile('悬挂节点', formatCount(topology.danglingNodeCount), '度 = 1'),
      createTile('孤立节点', formatCount(topology.isolatedNodeCount), '度 = 0'),
      createTile('平均度', topology.averageDegree.toFixed(2), '2E / V'),
    );
    topologyCard.append(grid);
    topologyCard.append(element('p', 'gis-note', `来源：${stats.topologySource}`));
  }

  function render(stats: NetworkStats): void {
    const topological = stats.topology !== null;

    kpis.replaceChildren(
      createTile('节点数', formatCount(stats.nodeCount)),
      createTile('有向边数', formatCount(stats.edgeCount)),
      createTile('道路数', formatCount(stats.wayCount), '按 way 去重'),
      createTile('总里程', formatKilometers(stats.totalLengthMeters)),
      createTile('总通行时间', formatDuration(stats.totalTravelSeconds), '按当前限速'),
      createTile(
        '平均 / 中位边长',
        `${stats.meanEdgeMeters.toFixed(0)} / ${stats.medianEdgeMeters.toFixed(0)} m`,
      ),
    );

    const topHighways = stats.byHighway.slice(0, 10);
    charts_.length.setOption(
      horizontalBarOption({
        categories: topHighways.map((row) => row.highway),
        values: topHighways.map((row) => roundKilometers(row.lengthMeters)),
        colors: [...CHART_PALETTE],
        axisName: '里程 (km)',
      }),
      true,
    );

    const mainHighways = stats.byHighway.slice(0, DONUT_TOP_N);
    const rest = stats.byHighway.slice(DONUT_TOP_N);
    const donutItems = mainHighways.map((row) => ({
      name: row.highway,
      value: roundKilometers(row.lengthMeters),
    }));
    if (rest.length > 0) {
      donutItems.push({
        name: `其他 ${rest.length} 类`,
        value: roundKilometers(rest.reduce((sum, row) => sum + row.lengthMeters, 0)),
      });
    }
    charts_.share.setOption(donutOption({ items: donutItems }), true);

    charts_.histogram.setOption(
      histogramOption({
        labels: stats.lengthHistogram.map((bucket) => bucket.label),
        values: stats.lengthHistogram.map((bucket) => bucket.edgeCount),
        axisName: '边数',
      }),
      true,
    );

    renderTopology(stats);

    const speedFactor = stats.profile.speedFactor;
    const factorText = speedFactor === 1 ? '默认限速' : `速度系数 ×${speedFactor}`;
    const leading = stats.byHighway[0];
    summaryNote.textContent =
      `口径：${factorText}` +
      (leading === undefined
        ? ''
        : `；里程最多的等级为 ${leading.highway}（${formatPercent(leading.lengthShare)}，平均 ${formatSpeed(leading.averageSpeedKmh)}）`) +
      (topological ? '。' : '；拓扑指标尚未接入，见上方说明。');
  }

  function setSource(label: string, ok: boolean): void {
    sourceBadge.textContent = label;
    sourceBadge.className = `gis-badge ${ok ? 'gis-badge--ok' : 'gis-badge--wait'}`;
  }

  return {
    element: root,
    render,
    setSource,
    dispose: () => {
      for (const stop of stopResize) stop();
      for (const chart of Object.values(charts_)) chart.dispose();
    },
  };
}

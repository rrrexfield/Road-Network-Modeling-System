/**
 * 可达性(等时圈)卡片(Sprint 3 · issue #65):给定起点节点与时间预算,
 * 展示可达节点数、可达里程与分等级里程分布。
 *
 * 数据来自 GET /api/accessibility(D 的 weights 插件提供,随 registerWeightRoutes 自动生效);
 * 接口未就绪时显示占位态,不以空数据冒充结果。里程口径为"按边统计、两端均可达才计入",
 * 说明随响应 notes 下发,卡片原文转述。
 */
import {
  CHART_COLORS,
  autoResize,
  createChart,
  formatCount,
  formatKilometers,
  horizontalBarOption,
  roundKilometers,
} from '../../charts/index.js';
import { fetchAccessibility, type AccessibilityReportView } from './api.js';
import './accessibility-card.css';

/** 卡片句柄。 */
export interface AccessibilityCardHandle {
  element: HTMLElement;
  /** 主动按当前控件取数刷新(初始化后调用一次)。 */
  refresh(): void;
  dispose(): void;
}

/** 预算滑杆范围(分钟)。 */
const BUDGET_MIN = 5;
const BUDGET_MAX = 60;
const BUDGET_STEP = 5;
const BUDGET_DEFAULT = 15;

const MODES: Array<{ value: string; label: string }> = [
  { value: 'car', label: '驾车' },
  { value: 'walk', label: '步行' },
  { value: 'bike', label: '骑行' },
  { value: 'bus', label: '公交' },
];

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

/**
 * 创建可达性卡片。
 * @param options.initialOrigin 初始起点节点 id;真实节点 id 依赖数据,缺省 1(演示口径)。
 */
export function createAccessibilityCard(options?: {
  initialOrigin?: number;
}): AccessibilityCardHandle {
  let origin = options?.initialOrigin ?? 1;
  let budget = BUDGET_DEFAULT;
  let mode = 'car';
  let requestToken = 0;

  const root = element('section', 'gis-panel gis-access');
  const head = element('header', 'gis-panel__head');
  head.append(element('h2', 'gis-panel__title', '可达性分析(等时圈)'));
  const statusBadge = element('span', 'gis-badge gis-badge--wait', '未查询');
  head.append(statusBadge);
  root.append(head);

  // ---- 控件区 ----
  const controls = element('div', 'gis-access__controls');

  const originField = element('div', 'gis-field');
  originField.append(element('span', 'gis-field__label', '起点节点 id'));
  const originInput = document.createElement('input');
  originInput.type = 'number';
  originInput.className = 'gis-input gis-input--num';
  originInput.min = '0';
  originInput.step = '1';
  originInput.value = String(origin);
  originInput.placeholder = '节点 id';
  originInput.addEventListener('change', () => {
    const parsed = Number(originInput.value);
    if (Number.isInteger(parsed) && parsed >= 0) {
      origin = parsed;
      refresh();
    } else {
      originInput.value = String(origin);
    }
  });
  originField.append(originInput);
  controls.append(originField);

  const budgetField = element('div', 'gis-field');
  budgetField.append(element('span', 'gis-field__label', '时间预算(分钟)'));
  const budgetInput = document.createElement('input');
  budgetInput.type = 'range';
  budgetInput.className = 'gis-range';
  budgetInput.min = String(BUDGET_MIN);
  budgetInput.max = String(BUDGET_MAX);
  budgetInput.step = String(BUDGET_STEP);
  budgetInput.value = String(budget);
  const budgetValue = element('span', 'gis-field__value', `${budget} 分钟`);
  budgetInput.addEventListener('input', () => {
    budget = Number(budgetInput.value);
    budgetValue.textContent = `${budget} 分钟`;
  });
  budgetInput.addEventListener('change', () => refresh());
  budgetField.append(budgetInput, budgetValue);
  controls.append(budgetField);

  const modeField = element('div', 'gis-field');
  modeField.append(element('span', 'gis-field__label', '交通模态'));
  const modeSelect = document.createElement('select');
  modeSelect.className = 'gis-input';
  for (const entry of MODES) {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    modeSelect.append(option);
  }
  modeSelect.addEventListener('change', () => {
    mode = modeSelect.value;
    refresh();
  });
  modeField.append(modeSelect);
  controls.append(modeField);

  root.append(controls);

  // ---- 结果区 ----
  const kpis = element('div', 'gis-kpis');
  const barCard = element('figure', 'gis-card');
  const barCaption = element('figcaption', 'gis-card__caption');
  barCaption.append(
    element('span', 'gis-card__title', '可达里程按等级分布'),
    element('span', 'gis-card__hint', '按边统计 · 两端均可达才计入'),
  );
  const barBody = element('div', 'gis-card__body');
  barCard.append(barCaption, barBody);
  root.append(kpis, barCard);

  const chart = createChart(barBody);
  const stopResize = autoResize(chart, barBody);

  const placeholder = element('div', 'gis-placeholder gis-placeholder--overlay');
  placeholder.hidden = true;
  placeholder.append(
    element('span', 'gis-badge gis-badge--wait', '接口未就绪'),
    element(
      'p',
      'gis-placeholder__text',
      '等时圈统计来自 GET /api/accessibility(weights 插件);' +
        '接口不可用时本区不显示数值——没有数据不等于可达性是 0。',
    ),
  );
  root.append(placeholder);

  function paintKpis(report: AccessibilityReportView): void {
    const kpi = (label: string, value: string, hint?: string): HTMLElement => {
      const node = element('div', 'gis-kpi');
      node.append(element('div', 'gis-kpi__label', label), element('div', 'gis-kpi__value', value));
      if (hint !== undefined) node.append(element('div', 'gis-kpi__hint', hint));
      return node;
    };
    kpis.replaceChildren(
      kpi('可达节点', formatCount(report.reachableNodeCount)),
      kpi('可达里程', formatKilometers(report.reachableLengthMeters)),
      kpi('可达有向边', formatCount(report.reachableEdgeCount)),
      kpi(
        '预算',
        `${Math.round(report.budgetSeconds / 60)} min`,
        `${modeLabel(report.mode)}${report.truncated ? ' · 结果被截断' : ''}`,
      ),
    );
  }

  function modeLabel(value: string): string {
    return MODES.find((entry) => entry.value === value)?.label ?? value;
  }

  function paint(report: AccessibilityReportView): void {
    paintKpis(report);
    placeholder.hidden = true;
    if (report.byHighway.length === 0) {
      chart.clear();
      barBody.append(
        element('p', 'gis-note', '预算内无两端均可达的边:预算过紧、起点孤悬或相关路段被事件封闭。'),
      );
      return;
    }
    const top = report.byHighway.slice(0, 10);
    chart.setOption(
      horizontalBarOption({
        categories: top.map((row) => row.highway),
        values: top.map((row) => roundKilometers(row.lengthMeters)),
        colors: [CHART_COLORS.accent],
        axisName: '可达里程 (km)',
      }),
      true,
    );
  }

  function refresh(): void {
    const token = ++requestToken;
    statusBadge.textContent = '查询中…';
    statusBadge.className = 'gis-badge gis-badge--wait';
    void fetchAccessibility({
      originNode: origin,
      budgetMinutes: budget,
      mode,
    }).then((report) => {
      if (token !== requestToken) return; // 丢弃过期响应
      if (report === null) {
        statusBadge.textContent = '接口未就绪';
        statusBadge.className = 'gis-badge gis-badge--wait';
        kpis.replaceChildren();
        chart.clear();
        placeholder.hidden = false;
        return;
      }
      statusBadge.textContent = `起点 #${report.originNode} · 实时`;
      statusBadge.className = 'gis-badge gis-badge--ok';
      paint(report);
    });
  }

  return {
    element: root,
    refresh,
    dispose: () => {
      stopResize();
      chart.dispose();
    },
  };
}

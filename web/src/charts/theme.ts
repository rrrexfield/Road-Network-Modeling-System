/**
 * 图表深色主题:配色与 AGENTS.md 的前端样式基线一致
 * (底色 #101418 / 正文 #d7dde6 / 点缀金 #f2c66d),不引入新的主色。
 */
import { echarts } from './setup.js';

/** 注册到 ECharts 的主题名。 */
export const CHART_THEME = 'gisalgo-dark';

/** 图表用到的少量色值。 */
export const CHART_COLORS = {
  text: '#d7dde6',
  muted: '#9aa4b2',
  axis: '#3a4453',
  accent: '#f2c66d',
} as const;

/** 系列调色板:金色领衔,其余为中低饱和可区分色,保证深色底上可读。 */
export const CHART_PALETTE = [
  '#f2c66d',
  '#7fd6a0',
  '#8fb6ff',
  '#e8c477',
  '#c9a0ff',
  '#6fd3e0',
  '#e88f8a',
  '#a8d08d',
] as const;

echarts.registerTheme(CHART_THEME, {
  color: [...CHART_PALETTE],
  backgroundColor: 'transparent',
  textStyle: {
    color: CHART_COLORS.text,
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif",
    fontSize: 12,
  },
  // 悬浮提示沿用面板基调:半透明深色底 + 金色描边
  tooltip: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    borderColor: 'rgba(242, 198, 109, 0.35)',
    borderWidth: 1,
    textStyle: { color: '#eef2f7', fontSize: 12 },
    axisPointer: {
      lineStyle: { color: CHART_COLORS.axis },
      crossStyle: { color: CHART_COLORS.axis },
      shadowStyle: { color: 'rgba(255, 255, 255, 0.04)' },
    },
  },
  legend: { textStyle: { color: CHART_COLORS.muted } },
  categoryAxis: {
    axisLine: { lineStyle: { color: CHART_COLORS.axis } },
    axisTick: { show: false },
    axisLabel: { color: CHART_COLORS.muted },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: CHART_COLORS.muted },
    splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } },
  },
});

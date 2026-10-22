/**
 * 图表模块公开入口(ECharts 封装)。
 */
export { echarts, type ChartInstance } from './setup.js';
export { CHART_COLORS, CHART_PALETTE, CHART_THEME } from './theme.js';
export {
  autoResize,
  createChart,
  donutOption,
  histogramOption,
  horizontalBarOption,
} from './factory.js';
export {
  formatCount,
  formatDuration,
  formatKilometers,
  formatPercent,
  formatSpeed,
  roundKilometers,
} from './format.js';
export type {
  HighwayStat,
  LengthBucket,
  NetworkStats,
  TopologyMetrics,
  TopologyMetricsSourceTag,
  WeightProfile,
  WeightProfileResponse,
} from './contract.js';

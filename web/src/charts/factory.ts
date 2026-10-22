/**
 * 图表工厂:把常用图表形态固化为纯函数选项,面板只负责喂数据。
 * 选项里不出现业务字段名,业务映射留在各面板(stats / weight)。
 */
import type { EChartsOption } from 'echarts';
import { echarts, type ChartInstance } from './setup.js';
import { CHART_COLORS, CHART_THEME } from './theme.js';

/**
 * 在容器上创建图表实例。
 * @param container 宿主元素(需有确定的宽高,否则画布为 0)。
 * @returns 应用了深色主题的 ECharts 实例。
 * @remarks 首次渲染与容器尺寸无关的选项由调用方 setOption 提供。
 */
export function createChart(container: HTMLElement): ChartInstance {
  return echarts.init(container, CHART_THEME, { renderer: 'canvas' });
}

/**
 * 横向条形图:类别名较长或类别数较多时比纵向柱状更易读。
 * @param input.categories y 轴类别(自上而下)。
 * @param input.values 与 categories 等长的数值,调用方需自行取整/换算单位。
 * @param input.colors 逐条着色,索引循环取用。
 * @param input.axisName x 轴单位说明。
 * @returns ECharts 选项。
 */
export function horizontalBarOption(input: {
  categories: string[];
  values: number[];
  colors: string[];
  axisName: string;
}): EChartsOption {
  return {
    grid: { left: 4, right: 56, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value',
      name: input.axisName,
      nameTextStyle: { color: CHART_COLORS.muted },
      nameGap: 6,
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: input.categories,
      axisLabel: { color: CHART_COLORS.text },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 16,
        data: input.values.map((value, index) => ({
          value,
          itemStyle: {
            color: input.colors[index % input.colors.length]!,
            borderRadius: [0, 4, 4, 0],
          },
        })),
        // 用字符串模板而非回调,避免绑定 echarts 内部回调类型
        label: { show: true, position: 'right', color: CHART_COLORS.muted, formatter: '{c}' },
      },
    ],
  };
}

/**
 * 环形图:展示构成占比,中心留白避免与图例挤压。
 * @param input.items 名称与数值(数值单位由调用方统一)。
 * @returns ECharts 选项。
 */
export function donutOption(input: { items: { name: string; value: number }[] }): EChartsOption {
  return {
    tooltip: { trigger: 'item' },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 0,
      top: 'center',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['32%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#101418', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          label: { show: true, color: CHART_COLORS.accent, fontSize: 13, formatter: '{b}\n{d}%' },
        },
        data: input.items,
      },
    ],
  };
}

/**
 * 纵向直方图:展示数值分档频次。
 * @param input.labels 分档标签。
 * @param input.values 与 labels 等长的频次。
 * @param input.axisName y 轴单位说明。
 * @returns ECharts 选项。
 */
export function histogramOption(input: {
  labels: string[];
  values: number[];
  axisName: string;
}): EChartsOption {
  return {
    grid: { left: 4, right: 12, top: 28, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: input.labels, axisLabel: { fontSize: 11 } },
    yAxis: {
      type: 'value',
      name: input.axisName,
      nameTextStyle: { color: CHART_COLORS.muted },
      nameGap: 6,
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 36,
        data: input.values,
        itemStyle: { color: '#8fb6ff', borderRadius: [4, 4, 0, 0] },
      },
    ],
  };
}

/**
 * 跟随容器尺寸自适应重绘。
 * @param chart 图表实例。
 * @param container 被观察的宿主元素。
 * @returns 停止观察的回调(卸载面板时调用,避免观察器泄漏)。
 */
export function autoResize(chart: ChartInstance, container: HTMLElement): () => void {
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(container);
  return () => observer.disconnect();
}

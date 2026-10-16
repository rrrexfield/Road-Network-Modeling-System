/**
 * ECharts 按需装配:只注册本项目实际用到的图表与组件,避免整包引入。
 * 主题见 theme.ts,图表工厂见 factory.ts。
 */
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export { echarts };

/** 图表实例类型。用 ReturnType 推导,避免绑定某一版 echarts 的类型导出路径。 */
export type ChartInstance = ReturnType<typeof echarts.init>;

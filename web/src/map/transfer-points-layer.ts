import type { Layer } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { TransferPoint } from '@gisalgo/shared';
import type { MapTheme } from './theme-model.js';

const TRANSFER_POINT_MIN_LABEL_ZOOM = 15;

const TRANSFER_POINT_COLORS = {
  dark: {
    base: [14, 19, 23, 185] as [number, number, number, number],
    line: [242, 198, 109, 88] as [number, number, number, number],
  },
  white: {
    base: [255, 255, 255, 215] as [number, number, number, number],
    line: [49, 95, 125, 150] as [number, number, number, number],
  },
  normal: {
    base: [247, 249, 250, 220] as [number, number, number, number],
    line: [36, 91, 122, 155] as [number, number, number, number],
  },
} as const;

/**
 * 城市级缩放只显示小点;放大到路口级后改用 Font Awesome 图标
 * (由 `transfer-point-overlay.ts` 以 DOM 覆盖层绘制,详见该文件的说明)。
 *
 * 阈值取 15:步行模式有 2930 个转换点,更低缩放级别会挤进上百个图标;
 * 15 级以下只显示地图内小点,达到路口级后才显示图标。
 */
export function shouldShowTransferLabels(zoom: number): boolean {
  return zoom >= TRANSFER_POINT_MIN_LABEL_ZOOM;
}

/** 路口级图标随缩放继续增长；15 级为 1 倍，最高封顶 2.4 倍。 */
export function transferPointIconScale(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= TRANSFER_POINT_MIN_LABEL_ZOOM) return 1;
  return Math.min(2.4, 1 + (zoom - TRANSFER_POINT_MIN_LABEL_ZOOM) * 0.24);
}

/**
 * 创建转换点的底板小点(仅城市级缩放使用)。
 *
 * @param points 转换点。
 * @param zoom 当前缩放级别。
 * @returns deck.gl 图层;放大到路口级后返回空数组(图标由 DOM 覆盖层负责)。
 */
export function createTransferPointsLayers(
  points: TransferPoint[],
  zoom: number,
  theme: MapTheme = 'dark',
): Layer[] {
  if (shouldShowTransferLabels(zoom)) return [];
  const colors = TRANSFER_POINT_COLORS[theme];
  return [
    new ScatterplotLayer<TransferPoint>({
      id: 'transfer-point-bases',
      data: points,
      getPosition: (point) => point.position,
      getFillColor: colors.base,
      getLineColor: colors.line,
      getRadius: 3.2,
      radiusUnits: 'pixels',
      lineWidthMinPixels: 0.8,
      stroked: true,
      pickable: false,
    }),
  ];
}

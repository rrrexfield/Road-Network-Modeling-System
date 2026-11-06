import type { Layer } from '@deck.gl/core';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { TransferPoint } from '@gisalgo/shared';

const GOLD_MUTED: [number, number, number, number] = [242, 198, 109, 88];
const BASE: [number, number, number, number] = [14, 19, 23, 185];

/**
 * 城市级缩放只显示小点;放大到路口级后改用 Font Awesome 图标
 * (由 `transfer-point-overlay.ts` 以 DOM 覆盖层绘制,详见该文件的说明)。
 *
 * 阈值取 13.5 而不是 12.5:步行模式有 2930 个转换点,12.5 级时一个视口内会挤进
 * 上百个图标,互相压盖反而看不清;13.5 级后视口内通常只剩几十个,图标可辨。
 */
export function shouldShowTransferLabels(zoom: number): boolean {
  return zoom >= 13.5;
}

/**
 * 创建转换点的底板小点(仅城市级缩放使用)。
 *
 * @param points 转换点。
 * @param zoom 当前缩放级别。
 * @returns deck.gl 图层;放大到路口级后返回空数组(图标由 DOM 覆盖层负责)。
 */
export function createTransferPointsLayers(points: TransferPoint[], zoom: number): Layer[] {
  if (shouldShowTransferLabels(zoom)) return [];
  return [
    new ScatterplotLayer<TransferPoint>({
      id: 'transfer-point-bases',
      data: points,
      getPosition: (point) => point.position,
      getFillColor: BASE,
      getLineColor: GOLD_MUTED,
      getRadius: 3.2,
      radiusUnits: 'pixels',
      lineWidthMinPixels: 0.8,
      stroked: true,
      pickable: false,
    }),
  ];
}

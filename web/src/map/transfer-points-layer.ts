import type { Layer } from '@deck.gl/core';
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { TransferPoint } from '@gisalgo/shared';

const GOLD: [number, number, number, number] = [242, 198, 109, 205];
const GOLD_MUTED: [number, number, number, number] = [242, 198, 109, 88];
const BASE: [number, number, number, number] = [14, 19, 23, 185];
const SHADOW: [number, number, number, number] = [10, 14, 18, 255];

/** 转换点类型对应单字母标记，避免引入额外图标资源。 */
export function transferPointSymbol(kind: TransferPoint['kind']): string {
  switch (kind) {
    case 'subway':
      return 'M';
    case 'bus':
      return 'B';
    case 'parking':
      return 'P';
  }
}

/** 城市级缩放只显示小点，放大到路口级后才显示字母。 */
export function shouldShowTransferLabels(zoom: number): boolean {
  return zoom >= 12.5;
}

/** 创建转换点底板和字母标识；图层不可拾取，不抢占道路点击。 */
export function createTransferPointsLayers(points: TransferPoint[], zoom: number): Layer[] {
  const detailed = shouldShowTransferLabels(zoom);
  const layers: Layer[] = [
    new ScatterplotLayer<TransferPoint>({
      id: 'transfer-point-bases',
      data: points,
      getPosition: (point) => point.position,
      getFillColor: BASE,
      getLineColor: detailed ? GOLD : GOLD_MUTED,
      getRadius: detailed ? 6 : 3.2,
      radiusUnits: 'pixels',
      lineWidthMinPixels: detailed ? 1.2 : 0.8,
      stroked: true,
      pickable: false,
    }),
  ];
  if (detailed) {
    layers.push(
      new TextLayer<TransferPoint>({
        id: 'transfer-point-symbols',
        data: points,
        getPosition: (point) => point.position,
        getText: (point) => transferPointSymbol(point.kind),
        getColor: GOLD,
        getSize: 7,
        sizeUnits: 'pixels',
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontWeight: 700,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        outlineWidth: 1,
        outlineColor: SHADOW,
        billboard: true,
        pickable: false,
      }),
    );
  }
  return layers;
}

/**
 * 路网图层：把 /api/network 返回的 GeoJSON 渲染成 deck.gl PathLayer。
 *
 * 配色与线宽统一取自 @gisalgo/shared（前后端共用），本文件不硬编码颜色。
 */
import { PathLayer } from '@deck.gl/layers';
import { highwayWidth, type RoadFeature } from '@gisalgo/shared';
import {
  createRoadColorResolver,
  type RoadColorMode,
  type RoadColorSpeedContext,
} from './road-color-model.js';

export interface RoadLayerOptions {
  colorMode?: RoadColorMode;
  speedContext?: RoadColorSpeedContext;
}

/** 创建路网图层。widthUnits 为 meters，缩放时线宽随地图比例尺变化。 */
export function createRoadsLayer(
  data: RoadFeature[],
  options: RoadLayerOptions = {},
): PathLayer<RoadFeature> {
  const getColor = createRoadColorResolver(options.colorMode ?? 'highway', options.speedContext);
  return new PathLayer<RoadFeature>({
    id: `roads-${options.colorMode ?? 'highway'}`,
    data,
    getPath: (f) => f.geometry.coordinates,
    getColor,
    getWidth: (f) => highwayWidth(f.properties.highway),
    widthUnits: 'meters',
    widthMinPixels: 1,
    capRounded: true,
    jointRounded: true,
    pickable: true,
  });
}

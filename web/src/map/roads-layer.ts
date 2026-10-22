/**
 * 路网图层：把 /api/network 返回的 GeoJSON 渲染成 deck.gl PathLayer。
 *
 * 配色与线宽统一取自 @gisalgo/shared（前后端共用），本文件不硬编码颜色。
 */
import { PathLayer } from '@deck.gl/layers';
import { highwayColor, highwayWidth, type RoadFeature } from '@gisalgo/shared';

/** 创建路网图层。widthUnits 为 meters，缩放时线宽随地图比例尺变化。 */
export function createRoadsLayer(data: RoadFeature[]): PathLayer<RoadFeature> {
  return new PathLayer<RoadFeature>({
    id: 'roads',
    data,
    getPath: (f) => f.geometry.coordinates,
    getColor: (f) => highwayColor(f.properties.highway),
    getWidth: (f) => highwayWidth(f.properties.highway),
    widthUnits: 'meters',
    widthMinPixels: 1,
    capRounded: true,
    jointRounded: true,
    pickable: true,
  });
}
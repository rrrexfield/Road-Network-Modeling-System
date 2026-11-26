import type { Layer } from '@deck.gl/core';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { IntersectionTurns } from '@gisalgo/shared';
import {
  buildRestrictionArcs,
  buildRestrictionArrows,
  type RestrictionArc,
  type RestrictionArrow,
  type WayGeometryLookup,
} from './turn-restriction-arcs.js';

const FORBIDDEN: [number, number, number, number] = [232, 136, 136, 235];
const GOLD: [number, number, number, number] = [242, 198, 109, 235];
type RestrictionArrowWithHead = RestrictionArrow & { arrowhead: [number, number][] };

/**
 * 禁转箭头只用于可视化，不参与路径判定。
 * 有道路几何时绘制真实驶入臂到目标出臂的箭头；几何缺失时降级为旧示意弧线。
 */
export function createTurnRestrictionLayers(
  intersection: IntersectionTurns | null,
  wayGeometries?: WayGeometryLookup,
): Layer[] {
  if (intersection === null) return [];
  const arrows =
    wayGeometries === undefined ? [] : buildRestrictionArrows(intersection, wayGeometries);
  const arrowKeys = new Set(arrows.map((arrow) => arrow.key));
  const fallbackArcs = buildRestrictionArcs(intersection).filter((arc) => !arrowKeys.has(arc.key));
  const forbiddenCount = intersection.turns.filter((turn) => turn.forbidden).length;
  const layers: Layer[] = [
    new ScatterplotLayer<IntersectionTurns>({
      id: 'turn-editor-intersection',
      data: [intersection],
      getPosition: (item) => item.position,
      getFillColor: [242, 198, 109, 28],
      getLineColor: GOLD,
      getRadius: 15,
      radiusUnits: 'pixels',
      lineWidthMinPixels: 2,
      stroked: true,
      pickable: false,
    }),
  ];
  if (arrows.length > 0) {
    layers.push(
      new PathLayer<RestrictionArrow>({
        id: 'turn-restriction-arrows',
        data: arrows,
        getPath: (arrow) => arrow.path,
        getColor: FORBIDDEN,
        getWidth: 3.5,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: false,
      }),
    );
    const arrowheads = arrows.filter(
      (arrow): arrow is RestrictionArrowWithHead => arrow.arrowhead !== undefined,
    );
    if (arrowheads.length > 0) {
      layers.push(
        new PolygonLayer<RestrictionArrowWithHead>({
          id: 'turn-restriction-arrowheads',
          data: arrowheads,
          getPolygon: (arrow) => arrow.arrowhead,
          getFillColor: FORBIDDEN,
          getLineColor: [10, 14, 18, 210],
          stroked: true,
          filled: true,
          lineWidthMinPixels: 1,
          pickable: false,
        }),
      );
    }
  }
  if (fallbackArcs.length > 0) {
    layers.push(
      new PathLayer<RestrictionArc>({
        id: 'turn-restriction-arcs-fallback',
        data: fallbackArcs,
        getPath: (arc) => arc.path,
        getColor: FORBIDDEN,
        getWidth: 2.5,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: false,
      }),
    );
  }
  if (forbiddenCount > 0) {
    layers.push(
      new TextLayer<IntersectionTurns>({
        id: 'turn-restriction-count',
        data: [intersection],
        getPosition: (item) => item.position,
        getText: () => `禁 ${forbiddenCount}`,
        getColor: FORBIDDEN,
        getSize: 10,
        sizeUnits: 'pixels',
        getPixelOffset: [0, -27],
        fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
        fontWeight: 700,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        outlineWidth: 2,
        outlineColor: [10, 14, 18, 255],
        billboard: true,
        pickable: false,
      }),
    );
  }
  return layers;
}

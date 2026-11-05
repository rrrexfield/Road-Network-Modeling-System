import type { Layer } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { IntersectionTurns } from '@gisalgo/shared';
import { buildRestrictionArcs, type RestrictionArc } from './turn-restriction-arcs.js';

const FORBIDDEN: [number, number, number, number] = [232, 136, 136, 235];
const GOLD: [number, number, number, number] = [242, 198, 109, 235];

/** 禁转弧线只用于可视化，不参与路径判定。 */
export function createTurnRestrictionLayers(intersection: IntersectionTurns | null): Layer[] {
  if (intersection === null) return [];
  const arcs = buildRestrictionArcs(intersection);
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
  if (arcs.length > 0) {
    layers.push(
      new PathLayer<RestrictionArc>({
        id: 'turn-restriction-arcs',
        data: arcs,
        getPath: (arc) => arc.path,
        getColor: FORBIDDEN,
        getWidth: 2.5,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        pickable: false,
      }),
      new TextLayer<IntersectionTurns>({
        id: 'turn-restriction-count',
        data: [intersection],
        getPosition: (item) => item.position,
        getText: () => `禁 ${arcs.length}`,
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

import type { IntersectionTurns } from '@gisalgo/shared';

export interface RestrictionArc {
  key: string;
  path: [number, number][];
}

/** 构建路口中心的红色示意弧线；精确边几何由后续契约扩展提供。 */
export function buildRestrictionArcs(intersection: IntersectionTurns): RestrictionArc[] {
  const [lon, lat] = intersection.position;
  const lonScale = Math.cos((lat * Math.PI) / 180);
  return intersection.turns
    .filter((turn) => turn.forbidden)
    .map((turn, index) => {
      const radius = 0.00018 + index * 0.000025;
      const delta = ((turn.angleDelta || 20) * Math.PI) / 180;
      const start = Math.PI / 2;
      const end = start - delta;
      const steps = Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / 12)));
      const path: [number, number][] = [];
      for (let step = 0; step <= steps; step += 1) {
        const angle = start + ((end - start) * step) / steps;
        path.push([lon + (Math.cos(angle) * radius) / lonScale, lat + Math.sin(angle) * radius]);
      }
      return { key: `${turn.fromEdge}:${turn.toEdge}`, path };
    });
}

import { describe, expect, it } from 'vitest';
import type { IntersectionTurns } from '@gisalgo/shared';
import { buildRestrictionArcs } from './turn-restriction-arcs.js';

describe('禁转示意弧线', () => {
  it('只为禁转动作构建弧线', () => {
    const intersection: IntersectionTurns = {
      nodeId: 1,
      position: [114.3, 30.5],
      turns: [
        {
          fromEdge: 1,
          toEdge: 2,
          fromWayId: 10,
          toWayId: 20,
          turnKind: 'left',
          angleDelta: -80,
          forbidden: true,
          fromOsm: false,
        },
        {
          fromEdge: 1,
          toEdge: 3,
          fromWayId: 10,
          toWayId: 30,
          turnKind: 'right',
          angleDelta: 80,
          forbidden: false,
          fromOsm: false,
        },
      ],
    };

    const arcs = buildRestrictionArcs(intersection);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.key).toBe('1:2');
    expect(arcs[0]!.path.length).toBeGreaterThan(2);
  });
});

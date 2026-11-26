import { describe, expect, it } from 'vitest';
import type { IntersectionTurns } from '@gisalgo/shared';
import { buildRestrictionArcs, buildRestrictionArrows } from './turn-restriction-arcs.js';

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

describe('禁转道路方向箭头', () => {
  const center: [number, number] = [114.3, 30.5];
  const eastWest: [number, number][] = [[114.299, 30.5], center, [114.301, 30.5]];
  const northSouth: [number, number][] = [[114.3, 30.499], center, [114.3, 30.501]];

  function intersection(
    overrides: Partial<IntersectionTurns['turns'][number]> = {},
  ): IntersectionTurns {
    return {
      nodeId: 1,
      position: center,
      turns: [
        {
          fromEdge: 10,
          toEdge: 20,
          fromWayId: 100,
          toWayId: 200,
          turnKind: 'left',
          angleDelta: -90,
          forbidden: true,
          fromOsm: false,
          ...overrides,
        },
      ],
    };
  }

  it('从驶入道路臂出发，箭头终结在禁转目标道路臂', () => {
    const arrows = buildRestrictionArrows(
      intersection(),
      new Map([
        [100, eastWest],
        [200, northSouth],
      ]),
    );
    expect(arrows).toHaveLength(1);
    const path = arrows[0]!.path;
    const start = path[0]!;
    const end = path[path.length - 1]!;
    expect(start[0]).toBeLessThan(center[0]); // 西侧道路臂
    expect(end[0]).toBeCloseTo(center[0], 6);
    expect(end[1]).toBeGreaterThan(center[1]); // 北侧目标道路臂
    expect(arrows[0]!.arrowhead).toHaveLength(3);
  });

  it('同一条 Way 的掉头只在目标道路臂上画红线', () => {
    const arrows = buildRestrictionArrows(
      intersection({
        fromWayId: 100,
        toWayId: 100,
        turnKind: 'u_turn',
        angleDelta: 180,
      }),
      new Map([[100, eastWest]]),
    );
    expect(arrows).toHaveLength(1);
    expect(arrows[0]!.path).toHaveLength(3);
    expect(arrows[0]!.path[0]![0]).toBeLessThan(center[0]);
    expect(arrows[0]!.path[2]![0]).toBeGreaterThan(center[0]);
    expect(arrows[0]!.arrowhead).toBeUndefined();
  });

  it('缺少道路几何时跳过箭头，不伪造方向', () => {
    expect(buildRestrictionArrows(intersection(), new Map())).toEqual([]);
  });
});

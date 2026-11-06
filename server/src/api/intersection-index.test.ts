import { describe, expect, it } from 'vitest';
import type { RoadEdge } from '@gisalgo/shared';
import { IntersectionIndex } from './intersection-index.js';

/**
 * 构造测试边；wayId 用于校验相连 Way 的回填。
 */
function edge(id: number, from: number, to: number, wayId = 1): RoadEdge {
  return { id, from, to, wayId };
}

/**
 * 十字路口：中心 0，四臂 1/2/3/4，双向边。
 * 中心节点的邻接节点数为 4 → 判为可编辑路口。
 */
function crossNodes(): Map<number, [number, number]> {
  return new Map<number, [number, number]>([
    [0, [30.5, 114.3]],
    [1, [30.5, 114.301]],
    [2, [30.5, 114.299]],
    [3, [30.501, 114.3]],
    [4, [30.499, 114.3]],
  ]);
}

function crossEdges(): RoadEdge[] {
  return [
    edge(0, 1, 0, 10),
    edge(1, 0, 1, 10),
    edge(2, 2, 0, 20),
    edge(3, 0, 2, 20),
    edge(4, 3, 0, 30),
    edge(5, 0, 3, 30),
    edge(6, 4, 0, 40),
    edge(7, 0, 4, 40),
  ];
}

describe('IntersectionIndex', () => {
  it('命中十字路口中心节点', () => {
    const index = new IntersectionIndex(crossNodes(), crossEdges());
    const found = index.findNearest(30.5, 114.3, 15, new Map());
    expect(found).not.toBeNull();
    expect(found!.nodeId).toBe(0);
    expect(found!.degree).toBe(4);
    expect(found!.distanceMeters).toBeCloseTo(0, 6);
  });

  it('回填相连 Way ID 与道路名', () => {
    const index = new IntersectionIndex(crossNodes(), crossEdges());
    const names = new Map([
      [10, '建设南路'],
      [20, '和平大道'],
    ]);
    const found = index.findNearest(30.5, 114.3, 15, names);
    expect(found!.connectedWayIds).toEqual([10, 20, 30, 40]);
    expect(found!.roadNames).toEqual(['建设南路', '和平大道']);
  });

  it('排除 degree=2 的道路折点与中间节点', () => {
    // 一条直线：0—1—2—3，中间节点 1、2 的邻接节点数都是 2
    const nodes = new Map<number, [number, number]>([
      [0, [30.5, 114.3]],
      [1, [30.5, 114.301]],
      [2, [30.5, 114.302]],
      [3, [30.5, 114.303]],
    ]);
    const edges = [
      edge(0, 0, 1),
      edge(1, 1, 0),
      edge(2, 1, 2),
      edge(3, 2, 1),
      edge(4, 2, 3),
      edge(5, 3, 2),
    ];
    const index = new IntersectionIndex(nodes, edges);
    // 点在节点 1 的位置，但没有交叉路口 → 不命中
    expect(index.findNearest(30.5, 114.301, 15, new Map())).toBeNull();
  });

  it('排除悬挂端点（邻接节点数为 1）', () => {
    const nodes = new Map<number, [number, number]>([
      [0, [30.5, 114.3]],
      [1, [30.5, 114.301]],
      [2, [30.5, 114.302]],
      [3, [30.5, 114.303]],
      [4, [30.5, 114.304]],
    ]);
    // 0 是四臂十字路口，4 是悬挂端点
    const edges = [
      ...crossEdges(),
      edge(8, 0, 1, 10),
      edge(9, 1, 0, 10),
      edge(10, 2, 0, 20),
      edge(11, 0, 2, 20),
      edge(12, 3, 0, 30),
      edge(13, 0, 3, 30),
      edge(14, 4, 0, 40),
      edge(15, 0, 4, 40),
      edge(16, 4, 5, 50),
    ];
    const index = new IntersectionIndex(nodes, edges);
    // 节点 4 现在有 2 个邻接节点(0 与 5)，仍不是路口
    expect(index.findNearest(30.5, 114.304, 15, new Map())).toBeNull();
    // 中心仍是路口
    expect(index.findNearest(30.5, 114.3, 15, new Map())?.nodeId).toBe(0);
  });

  it('超出阈值不命中（不返回最近的远处节点）', () => {
    const index = new IntersectionIndex(crossNodes(), crossEdges());
    // 距离中心约 100 米，超过 15 米阈值
    expect(index.findNearest(30.5, 114.301, 15, new Map())).toBeNull();
    // 放大阈值后命中
    expect(index.findNearest(30.5, 114.301, 150, new Map())?.nodeId).toBe(0);
  });

  it('返回距离由近及远择一，多路口时取最近', () => {
    const nodes = new Map<number, [number, number]>([
      [0, [30.5, 114.3]],
      [1, [30.5, 114.301]],
      [2, [30.5, 114.299]],
      [3, [30.501, 114.3]],
      [4, [30.499, 114.3]],
      // 第二个十字路口 5，四臂 6/7/8/9
      [5, [30.5005, 114.3005]],
      [6, [30.5005, 114.3006]],
      [7, [30.5005, 114.3004]],
      [8, [30.5006, 114.3005]],
      [9, [30.5004, 114.3005]],
    ]);
    const edges = [
      ...crossEdges(),
      edge(8, 5, 6),
      edge(9, 6, 5),
      edge(10, 5, 7),
      edge(11, 7, 5),
      edge(12, 5, 8),
      edge(13, 8, 5),
      edge(14, 5, 9),
      edge(15, 9, 5),
    ];
    const index = new IntersectionIndex(nodes, edges);
    const near0 = index.findNearest(30.5, 114.3, 15, new Map());
    expect(near0?.nodeId).toBe(0);
    const near5 = index.findNearest(30.5005, 114.3005, 15, new Map());
    expect(near5?.nodeId).toBe(5);
  });
});

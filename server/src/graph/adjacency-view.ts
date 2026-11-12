import type { RoadEdge } from '@gisalgo/shared';

/**
 * 只读邻接视图：边扩展搜索与坐标吸附所需的最小图接口。
 *
 * `Graph` 满足该接口（结构上），因此既有的 `dijkstraWithTurnRestrictions` / 吸附逻辑
 * 无需改动即可继续接受 `Graph`。引入它的目的：模态路径这类「权重已注入、只需几次查询」
 * 的场景，不必为每个模态重建一份完整 `Graph`（含边长预计算、出入度、紧凑坐标），
 * 用轻量视图即可，武汉 99 万边量级下显著降低堆占用。
 */
export interface ReadonlyAdjacency {
  hasNode(id: number): boolean;
  /** 迭代全部节点 id（坐标吸附用）。 */
  nodes(): IterableIterator<number>;
  outEdges(id: number): readonly RoadEdge[];
  edge(id: number): RoadEdge | undefined;
  coordinates(id: number): readonly [number, number] | undefined;
}

/**
 * 由节点表 + 有向边构建轻量只读邻接视图。
 *
 * 与 `Graph` 的差异：只建「出边邻接」与「按边 id 索引」，不预计算边长、不出入度、
 * 不复制坐标（直接复用传入的 nodes Map）、不建节点下标；边对象复用传入引用、不拷贝。
 * 适用于权重已由调用方注入、不需要 `edgeLength`/度数/统计的场景。
 */
export function createAdjacencyView(
  nodes: ReadonlyMap<number, readonly [number, number]>,
  edges: readonly RoadEdge[],
): ReadonlyAdjacency {
  const outAdj = new Map<number, RoadEdge[]>();
  const edgeById = new Map<number, RoadEdge>();
  for (const e of edges) {
    edgeById.set(e.id, e);
    const list = outAdj.get(e.from);
    if (list === undefined) outAdj.set(e.from, [e]);
    else list.push(e);
  }
  return {
    hasNode: (id) => nodes.has(id),
    nodes: () => nodes.keys(),
    outEdges: (id) => outAdj.get(id) ?? [],
    edge: (id) => edgeById.get(id),
    coordinates: (id) => nodes.get(id),
  };
}

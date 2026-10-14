import type { RoadEdge } from '@gisalgo/shared';
import { Graph } from './graph.js';
import { PriorityQueue } from './priority-queue.js';

/** 路径结果。TODO(契约): 待 A 提升到 shared/src/index.ts */
export interface PathResult {
  /** 总代价；不可达为 Infinity */
  distance: number;
  /** 起点→终点 节点 id 序列 */
  nodeIds: number[];
  /** 对应边 id 序列（比 nodeIds 少一项） */
  edgeIds: number[];
}

/** 边权函数；Sprint 3 起由 D 的权重模型注入。 */
export type EdgeWeightFn = (edge: RoadEdge) => number;

const EARTH_RADIUS_M = 6371000;

/** 两点球面距离（米），Haversine 公式。入参为 [lat, lon]。 */
function haversine(a: readonly [number, number], b: readonly [number, number]): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]);
  const la2 = toRad(b[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

function defaultEdgeWeight(graph: Graph): EdgeWeightFn {
  return (e) => {
    const a = graph.coordinates(e.from);
    const b = graph.coordinates(e.to);
    if (a === undefined || b === undefined) return Infinity;
    return haversine(a, b);
  };
}

/**
 * Dijkstra 最短路径（优先队列 + 惰性删除）。
 * @param graph 有向图。
 * @param source 起点节点 id。
 * @param target 终点节点 id。
 * @param weight 边权函数；默认端点 Haversine 距离（米）。
 * @returns 路径与总代价；源/目标缺失或不可达时 distance 为 Infinity、序列为空。
 * @remarks 同一节点可能被多次入队，已结算节点由 settled 集合跳过过期条目；
 * 对每条边松弛一次，复杂度 O((V+E) log V)。
 */
export function dijkstra(
  graph: Graph,
  source: number,
  target: number,
  weight?: EdgeWeightFn,
): PathResult {
  const edgeWeight = weight ?? defaultEdgeWeight(graph);

  if (!graph.hasNode(source) || !graph.hasNode(target)) {
    return { distance: Infinity, nodeIds: [], edgeIds: [] };
  }
  if (source === target) {
    return { distance: 0, nodeIds: [source], edgeIds: [] };
  }

  const dist = new Map<number, number>();
  const parentNode = new Map<number, number>();
  const parentEdge = new Map<number, number>();
  const settled = new Set<number>();
  const pq = new PriorityQueue<number>();

  dist.set(source, 0);
  pq.push(0, source);

  while (pq.size > 0) {
    const u = pq.pop()!.value;
    if (settled.has(u)) continue;
    settled.add(u);
    if (u === target) break;
    const du = dist.get(u)!;
    for (const e of graph.outEdges(u)) {
      const v = e.to;
      if (settled.has(v)) continue;
      const nd = du + edgeWeight(e);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        parentNode.set(v, u);
        parentEdge.set(v, e.id);
        pq.push(nd, v);
      }
    }
  }

  const dt = dist.get(target);
  if (dt === undefined) return { distance: Infinity, nodeIds: [], edgeIds: [] };

  const nodeIds: number[] = [];
  const edgeIds: number[] = [];
  let cur = target;
  while (cur !== source) {
    nodeIds.push(cur);
    edgeIds.push(parentEdge.get(cur)!);
    cur = parentNode.get(cur)!;
  }
  nodeIds.push(source);
  nodeIds.reverse();
  edgeIds.reverse();
  return { distance: dt, nodeIds, edgeIds };
}

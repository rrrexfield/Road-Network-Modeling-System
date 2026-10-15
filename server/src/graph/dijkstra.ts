import type { PathResult, RoadEdge } from '@gisalgo/shared';
import { Graph } from './graph.js';
import { PriorityQueue } from './priority-queue.js';

/** 边权函数；Sprint 3 起由 D 的权重模型注入。
 *  前置条件：返回值必须为 ≥ 0 且有限的数（负值破坏 Dijkstra 最优子结构，NaN/Infinity 使边被静默跳过）。
 *  注意当前签名不向调用方提供边长：Sprint 3 实现行程时间权重（长度/限速）前，
 *  需 A/D/B 评审扩展本签名或提供边长访问（见 CLAUDE.md 同步区，暂不冻结）。 */
export type EdgeWeightFn = (edge: RoadEdge) => number;

/** 默认边权：构造时预计算的 Haversine 球面长度（米），O(1) 读取。 */
function defaultEdgeWeight(graph: Graph): EdgeWeightFn {
  return (e) => graph.edgeLength(e.id);
}

/**
 * Dijkstra 最短路径（优先队列 + 惰性删除）。
 * @param graph 有向图。
 * @param source 起点节点 id。
 * @param target 终点节点 id。
 * @param weight 边权函数；默认端点 Haversine 距离（米，预计算）。
 * @returns 路径与总代价；源/目标缺失或不可达时 distance 为 Infinity、序列为空。
 * @remarks 内部状态按 Graph 稠密下标存于类型化数组；同一节点可能被多次入队，
 * 已结算节点跳过期条目；对每条边松弛一次，复杂度 O((V+E) log V)。
 */
export function dijkstra(
  graph: Graph,
  source: number,
  target: number,
  weight?: EdgeWeightFn,
): PathResult {
  const edgeWeight = weight ?? defaultEdgeWeight(graph);

  const sourceIdx = graph.indexOf(source);
  const targetIdx = graph.indexOf(target);
  if (sourceIdx === undefined || targetIdx === undefined) {
    return { distance: Infinity, nodeIds: [], edgeIds: [] };
  }
  if (source === target) {
    return { distance: 0, nodeIds: [source], edgeIds: [] };
  }

  const n = graph.nodeCount;
  const dist = new Float64Array(n).fill(Infinity);
  const parentIdx = new Int32Array(n).fill(-1);
  // 边 id 非稠密（不保证 < 2^31），用 float64 可精确存任意安全整数
  const parentEdgeId = new Float64Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const pq = new PriorityQueue<number>();

  dist[sourceIdx] = 0;
  pq.push(0, sourceIdx);

  while (pq.size > 0) {
    const ui = pq.pop()!.value;
    if (settled[ui]) continue;
    settled[ui] = 1;
    if (ui === targetIdx) break;
    const du = dist[ui]!;
    for (const e of graph.outEdges(graph.idAt(ui))) {
      const vi = graph.indexOf(e.to)!; // addEdge 已校验端点存在
      if (settled[vi]) continue;
      const nd = du + edgeWeight(e);
      if (nd < dist[vi]!) {
        dist[vi] = nd;
        parentIdx[vi] = ui;
        parentEdgeId[vi] = e.id;
        pq.push(nd, vi);
      }
    }
  }

  const dt = dist[targetIdx]!;
  if (dt === Infinity) return { distance: Infinity, nodeIds: [], edgeIds: [] };

  const nodeIds: number[] = [];
  const edgeIds: number[] = [];
  let cur = targetIdx;
  while (cur !== sourceIdx) {
    nodeIds.push(graph.idAt(cur));
    edgeIds.push(parentEdgeId[cur]!);
    cur = parentIdx[cur]!;
  }
  nodeIds.push(source);
  nodeIds.reverse();
  edgeIds.reverse();
  return { distance: dt, nodeIds, edgeIds };
}

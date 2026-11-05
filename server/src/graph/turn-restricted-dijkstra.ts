import type { PathResult } from '@gisalgo/shared';
import { Graph } from './graph.js';
import { PriorityQueue } from './priority-queue.js';
import type { EdgeWeightFn } from './dijkstra.js';

/**
 * 禁转判定函数：在 viaNode 路口，是否禁止从 fromEdge 转入 toEdge。
 * 默认全部允许，只记录被禁的边对（立项文档 §3.3.2 稀疏禁转表懒查）。
 *
 * 与 C 的 `TurnRestrictionTable.isForbidden`、`io` 的 `PersistentTurnService.isForbidden`
 * 签名一致：graph 模块只依赖这一只读函数形态，不依赖 topology / io 的具体类型，
 * 便于单测与后续 A* 复用。
 */
export type TurnRestrictionPredicate = (
  viaNode: number,
  fromEdge: number,
  toEdge: number,
) => boolean;

/** 起点无入边的哨兵：起点的出边不受任何转向限制，故以 -1 表示“无入边”。 */
const NO_INCOMING_EDGE = -1;

/** 默认边权：构造时预计算的 Haversine 球面长度（米），O(1) 读取。 */
function defaultEdgeWeight(graph: Graph): EdgeWeightFn {
  return (e) => graph.edgeLength(e.id);
}

/**
 * 支持转向限制的 Dijkstra 最短路径（边扩展状态空间）。
 *
 * ## 为什么状态必须是 (node, inEdge)，而不是纯节点
 *
 * 转向限制约束的不是节点，而是 (入边, 出边) 对——“从某条边驶入路口后禁止左转”。
 * 纯节点图的状态只有“我在 node”，丢失了来路信息，支配性剪枝因此出错：到达同一路口
 * 有两条路径（经西边代价 5、经南边代价 8），节点图保留 5、剪掉 8，但“经西边左转”
 * 被禁，真正可行的是被剪掉的“经南边直行”。错误不在算法，而在状态定义缺失入边维度。
 *
 * 因此本函数把搜索状态展开为“以哪条入边到达当前节点”：入边 `e` 唯一确定当前节点
 * `e.to`，故 (node, inEdge) 用入边 id 编码等价且更紧凑。松弛出边前查询一次禁转表：
 *
 * ```ts
 * for (const out of graph.outEdges(viaNode))
 *   if (!isTurnForbidden(viaNode, inEdge, out.id)) relax(out);
 * ```
 *
 * 不预建 O(E) 规模的展开图：编辑器改限制即改表项、立即生效，是物化 EEG 的等价替代。
 *
 * ## 与无限制 Dijkstra 的关系
 *
 * 未提供 `isTurnForbidden` 时等价于“全部允许”，结果与 `dijkstra` 的距离一致
 * （同为最短路，但边扩展状态下的平局解可能与节点版不同，调用方不得依赖平局时的具体边序列）。
 * 作业四的 A* 复用本 `TurnRestrictionPredicate`，在 `PriorityQueue` 的 key 上叠加
 * haversine 启发式即可，签名保持一致，故无需改动本接口。
 *
 * @param graph 有向图。
 * @param source 起点节点 id。
 * @param target 终点节点 id。
 * @param isTurnForbidden 禁转判定；缺省全部允许。
 * @param weight 边权函数；默认端点 Haversine 距离（米，预计算）。
 * @returns 路径与总代价；源/目标缺失或不可达时 distance 为 Infinity、序列为空。
 * @remarks 起点出边直接入队（无入边、不受限制）；终点判定为“首次结算到末端为目标
 * 节点的入边”即止，因优先队列按 key 非降弹出，此时代价已是目标节点的最短路。
 * 复杂度 O((V+E) log E)，状态数由节点放大到有向边。
 */
export function dijkstraWithTurnRestrictions(
  graph: Graph,
  source: number,
  target: number,
  isTurnForbidden?: TurnRestrictionPredicate,
  weight?: EdgeWeightFn,
): PathResult {
  const edgeWeight = weight ?? defaultEdgeWeight(graph);
  const forbidden = isTurnForbidden ?? (() => false);

  if (!graph.hasNode(source) || !graph.hasNode(target)) {
    return { distance: Infinity, nodeIds: [], edgeIds: [] };
  }
  if (source === target) {
    return { distance: 0, nodeIds: [source], edgeIds: [] };
  }

  /** 入边 id → 到达该入边末端节点的最短代价 */
  const dist = new Map<number, number>();
  /** 入边 id → 前一条入边 id（起点出边为 NO_INCOMING_EDGE） */
  const parentEdge = new Map<number, number>();
  const settled = new Set<number>();
  const pq = new PriorityQueue<number>();

  // 起点：所有出边都可直接驶入，不受转向限制（尚无入边）。
  for (const e of graph.outEdges(source)) {
    const d = edgeWeight(e);
    if (!Number.isFinite(d)) continue;
    dist.set(e.id, d);
    parentEdge.set(e.id, NO_INCOMING_EDGE);
    pq.push(d, e.id);
  }

  let arrivedEdge: number | undefined;
  while (pq.size > 0) {
    const inEdge = pq.pop()!.value;
    if (settled.has(inEdge)) continue;
    settled.add(inEdge);

    const viaNode = graph.edge(inEdge)!.to; // 入边末端即当前所在节点
    if (viaNode === target) {
      arrivedEdge = inEdge;
      break;
    }

    const du = dist.get(inEdge)!;
    for (const out of graph.outEdges(viaNode)) {
      if (forbidden(viaNode, inEdge, out.id)) continue;
      const nd = du + edgeWeight(out);
      if (!Number.isFinite(nd)) continue;
      if (nd >= (dist.get(out.id) ?? Infinity)) continue;
      dist.set(out.id, nd);
      parentEdge.set(out.id, inEdge);
      pq.push(nd, out.id);
    }
  }

  if (arrivedEdge === undefined) {
    return { distance: Infinity, nodeIds: [], edgeIds: [] };
  }

  // 边序列自带节点顺序：起点 → 每条入边的末端节点。
  const edgeIds: number[] = [];
  let cur = arrivedEdge;
  while (cur !== NO_INCOMING_EDGE) {
    edgeIds.push(cur);
    cur = parentEdge.get(cur)!;
  }
  edgeIds.reverse();

  const nodeIds: number[] = [source];
  for (const eid of edgeIds) nodeIds.push(graph.edge(eid)!.to);

  return { distance: dist.get(arrivedEdge)!, nodeIds, edgeIds };
}

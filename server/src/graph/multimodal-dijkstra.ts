import type { TravelMode } from '@gisalgo/shared';
import type { Graph } from './graph.js';
import type { EdgeWeightFn } from './dijkstra.js';
import type { TurnRestrictionPredicate } from './turn-restricted-dijkstra.js';
import { PriorityQueue } from './priority-queue.js';

/** 源节点无入边的哨兵：源节点的出边不受任何转向限制，故以 -1 表示“无入边”。 */
const NO_INCOMING_EDGE = -1;

/**
 * 单个交通模态的搜索层：一张有向图 + 该模态的边权 + 该模态的禁转表。
 *
 * 边权口径由调用方决定：距离口径传米、行程时间口径传秒，必须 ≥ 0 且有限。
 * 边 id 只在本层内有效，跨层不可复用（各模态子图独立构图）。
 */
export interface ModalLayer {
  /** 本层的交通模态（car / walk / bike / bus）。 */
  mode: TravelMode;
  /** 本层的路网图（该模态子图）。 */
  graph: Graph;
  /** 本层的边权函数（米或秒）；必须 ≥ 0 且有限。 */
  weight: EdgeWeightFn;
  /** 本层的禁转判定；缺省表示全部允许。 */
  isTurnForbidden?: TurnRestrictionPredicate;
}

/**
 * 相邻两层之间的换乘链接：把上一模态图的某个节点接到下一模态图的某个节点。
 *
 * 只有 `fromMode` / `toMode` 恰好等于 `layers[i]` / `layers[i+1]` 的链接会被使用，
 * 其余链接（非相邻层、模态不匹配）一律忽略。
 */
export interface TransferLink {
  /** 换乘前所在的模态。 */
  fromMode: TravelMode;
  /** 换乘点在上一模态图上的节点 id。 */
  fromNodeId: number;
  /** 换乘后的模态。 */
  toMode: TravelMode;
  /** 换乘点在下一模态图上的节点 id。 */
  toNodeId: number;
  /** 换乘罚时（秒）：等待 + 接驳步行；必须 ≥ 0 且有限。 */
  penaltySeconds: number;
  /** 对应 shared 的 `TransferPoint.id`。 */
  transferPointId: number;
}

/**
 * 跨模态路径的一段：段内是同一模态的连续行驶，段与段之间是换乘。
 *
 * `cost` 是段内路径代价（不含换乘罚时），与所属层的 `weight` 同量纲；
 * `nodeIds` 与 `edgeIds` 一一对应，`edgeIds` 比 `nodeIds` 少一项。
 */
export interface MultiModalSegment {
  /** 本段的交通模态。 */
  mode: TravelMode;
  /** 本段内部路径代价（不含换乘罚时），与该层 weight 同量纲。 */
  cost: number;
  /** 本段节点 id 序列（段起点 → 段终点）。 */
  nodeIds: number[];
  /** 本段边 id 序列；边 id 只在本段所属模态内有效。 */
  edgeIds: number[];
  /** 本段起点所在的转换点 id；首段缺省。 */
  fromTransferPoint?: number;
  /** 本段终点所在的转换点 id；末段缺省。 */
  toTransferPoint?: number;
}

/** 路径上实际使用的一次换乘。 */
export interface TransferUsage {
  /** 转换点 id（对应 shared 的 `TransferPoint.id`）。 */
  transferPointId: number;
  /** 换乘前的模态。 */
  fromMode: TravelMode;
  /** 换乘后的模态。 */
  toMode: TravelMode;
  /** 换乘点在上一模态图上的节点 id。 */
  fromNodeId: number;
  /** 换乘点在下一模态图上的节点 id。 */
  toNodeId: number;
  /** 换乘罚时（秒）。 */
  penaltySeconds: number;
}

/** 跨模态路径结果。 */
export interface MultiModalPath {
  /**
   * 总代价：Σ 段内代价 + Σ 换乘罚时（时间口径）；距离口径下换乘罚时不计入代价，
   * 此时总代价即 Σ 段内代价。不可达为 Infinity。
   */
  cost: number;
  /** 按行驶顺序排列的分段；不可达时为空数组。 */
  segments: MultiModalSegment[];
  /** 按行驶顺序排列的换乘记录；不可达时为空数组。 */
  transfers: TransferUsage[];
}

/** 层内搜索状态：以哪条入边到达当前节点；`inEdge = NO_INCOMING_EDGE` 表示“站在源节点上”。 */
interface LayerState {
  readonly node: number;
  readonly inEdge: number;
}

/** 单层的搜索结果：目标节点的到达代价 + 回溯所需的父边链。 */
interface LayerSearch {
  /** 目标节点 → 最终到达代价（只有到达过的目标才有值）。 */
  best: Map<number, number>;
  /** 目标节点 → 到达它的入边 id；`NO_INCOMING_EDGE` 表示“零边到达”（该节点即源节点）。 */
  bestEdge: Map<number, number>;
  /** 边 id → 到达代价（即到达该边末端节点的代价）。 */
  edgeDist: Map<number, number>;
  /** 边 id → 前一条入边 id；源节点的出边为 `NO_INCOMING_EDGE`。 */
  parentEdge: Map<number, number>;
  /** 源节点 → 初始代价（多源时同一节点取最小值）。 */
  sourceCost: Map<number, number>;
}

/** 一层的规划结果：层内搜索结果 + 本层出口（下一层源节点）选定的换乘链接。 */
interface LayerPlan {
  search: LayerSearch;
  /** 下一层源节点 → 本层选定的换乘链接与到达代价。 */
  next: Map<number, { link: TransferLink; cost: number }>;
}

/** 层内回溯出的一段路径。 */
interface SegmentPath {
  nodeIds: number[];
  edgeIds: number[];
  /** 段内代价（不含换乘罚时）。 */
  cost: number;
}

/**
 * 层内多源最短路（边扩展状态空间，支持禁转）。
 *
 * ## 原理
 *
 * 状态是 (节点, 入边)：转向限制约束的是 (入边, 出边) 边对，纯节点状态会丢失来路信息，
 * 导致支配性剪枝把唯一可行的路径剪掉。故以入边 id 编码状态（入边唯一确定其末端节点），
 * 松弛出边前查一次禁转表；源节点的出边视为“无入边”，不受任何禁转约束。
 *
 * 多源：每个源节点带一个初始代价，若同一源节点重复出现取最小初始代价；
 * 到达同一节点的不同入边都会继续展开（只有“该节点的最短到达代价”用于目标命中与早停）。
 *
 * 早停：所有目标节点都已结算、且当前弹出的代价已大于所有目标节点的最好代价时停止展开，
 * 目标集合外的节点不再展开。
 *
 * @param layer 本层的图、边权与禁转表。
 * @param sources 源节点 → 初始代价。
 * @param targets 本层需要回答的节点集合（换乘入口节点或终点）。
 * @returns 目标节点的到达代价与回溯所需的父边链。
 * @remarks 复杂度 O((V+E) log E)；不物化状态展开图（与 `dijkstraWithTurnRestrictions` 同策略）。
 */
function searchLayer(
  layer: ModalLayer,
  sources: ReadonlyMap<number, number>,
  targets: ReadonlySet<number>,
): LayerSearch {
  const graph = layer.graph;
  const weight = layer.weight;
  const forbidden = layer.isTurnForbidden ?? (() => false);

  const edgeDist = new Map<number, number>();
  const parentEdge = new Map<number, number>();
  const best = new Map<number, number>();
  const bestEdge = new Map<number, number>();
  const sourceCost = new Map<number, number>(sources);
  const settledEdges = new Set<number>();
  const settledSources = new Set<number>();
  /** 尚未到达的目标节点。 */
  const pending = new Set<number>(targets);
  /** 已到达目标的最大代价（目标按代价非降命中，故等于最后一次命中的代价）。 */
  let maxHitCost = -Infinity;

  const pq = new PriorityQueue<LayerState>();
  for (const [node, cost] of sources) pq.push(cost, { node, inEdge: NO_INCOMING_EDGE });

  while (pq.size > 0) {
    const entry = pq.pop()!;
    const key = entry.key;
    const { node, inEdge } = entry.value;

    let du: number;
    if (inEdge === NO_INCOMING_EDGE) {
      if (settledSources.has(node)) continue;
      settledSources.add(node);
      du = sourceCost.get(node)!;
    } else {
      if (settledEdges.has(inEdge)) continue;
      settledEdges.add(inEdge);
      du = edgeDist.get(inEdge)!;
    }

    // 首次结算即该节点的最短到达代价（优先队列按 key 非降弹出）。
    if (pending.has(node)) {
      pending.delete(node);
      best.set(node, du);
      bestEdge.set(node, inEdge);
      if (du > maxHitCost) maxHitCost = du;
    }
    // 全部目标均已结算且当前代价已大于所有目标的最好代价 → 停止展开。
    if (pending.size === 0 && key > maxHitCost) break;

    for (const out of graph.outEdges(node)) {
      // 源节点无入边，不受转向限制；其余状态按 (入边, 出边) 边对判定。
      if (inEdge !== NO_INCOMING_EDGE && forbidden(node, inEdge, out.id)) continue;
      const w = weight(out);
      if (!Number.isFinite(w)) continue;
      const nd = du + w;
      if (!Number.isFinite(nd)) continue;
      if (nd >= (edgeDist.get(out.id) ?? Infinity)) continue;
      edgeDist.set(out.id, nd);
      parentEdge.set(out.id, inEdge);
      pq.push(nd, { node: out.to, inEdge: out.id });
    }
  }

  return { best, bestEdge, edgeDist, parentEdge, sourceCost };
}

/**
 * 回溯某一层内从源到目标的路径。
 *
 * 沿 `parentEdge` 反查入边链直到源节点的出边，反转后即得边序列；
 * 节点序列由“首边的起点 + 各边的末端”拼成，故沿途 dist 自洽：
 * dist[父边] + weight(边) === dist[子边]。
 *
 * @param search 本层的搜索结果。
 * @param graph 本层的图。
 * @param target 本层的到达节点。
 * @returns 段内路径与段内代价；不可达返回 undefined。
 */
function reconstructSegment(
  search: LayerSearch,
  graph: Graph,
  target: number,
): SegmentPath | undefined {
  const inEdge = search.bestEdge.get(target);
  if (inEdge === undefined) return undefined;
  const total = search.best.get(target)!;

  // 零边到达：目标节点本身就是一个源节点。
  if (inEdge === NO_INCOMING_EDGE) {
    return { nodeIds: [target], edgeIds: [], cost: 0 };
  }

  const edgeIds: number[] = [];
  let cur = inEdge;
  while (cur !== NO_INCOMING_EDGE) {
    edgeIds.push(cur);
    cur = search.parentEdge.get(cur)!;
  }
  edgeIds.reverse();

  const nodeIds: number[] = [graph.edge(edgeIds[0]!)!.from];
  for (const eid of edgeIds) nodeIds.push(graph.edge(eid)!.to);

  // 段内代价 = 到达代价 - 源节点的初始代价（初始代价含上一层代价与换乘罚时）。
  const source = nodeIds[0]!;
  const cost = total - search.sourceCost.get(source)!;
  return { nodeIds, edgeIds, cost };
}

/**
 * 跨模态（多模态）最短路径：层内边扩展 Dijkstra + 层间动态规划。
 *
 * ## 状态空间
 *
 * 层内状态是 (节点, 入边)，与 `dijkstraWithTurnRestrictions` 一致：转向限制约束的是
 * (入边, 出边) 边对，纯节点状态会丢失来路信息，使支配性剪枝剪掉唯一可行的路径。
 * 层间状态是“换乘入口节点”，跨层不保留入边信息：换乘后站在新模态的入口节点上，
 * 其出边按“无入边”处理（与起点语义相同）。
 *
 * ## 层间推进（动态规划，不是贪心）
 *
 * `layers` 是有序模态序列，只有相邻层之间的换乘链接可用。第 i 层以“上一层各换乘入口
 * 节点 + 到达代价”为多源做层内最短路，得到每个候选换乘点的到达代价；对每个下一层入口
 * 节点取**全局最小**代价的换乘链接（同一入口有多个候选点时也要比较），再以这些入口
 * 与代价作为下一层的多源。因此存在多个候选换乘点时总代价是全局最优，而非“遇到第一个
 * 可用换乘点就换乘”。
 *
 * ## 换乘罚时口径
 *
 * `metric = 'time'`：换乘罚时计入总代价（与层内时间边权同量纲）；
 * `metric = 'distance'`（默认）：换乘罚时不计入代价，但仍作为分段边界并记入 `transfers`。
 * 段内 `cost` 一律不含换乘罚时。
 *
 * ## 复杂度
 *
 * 每层 O((V+E) log E)，层数 L 的总复杂度 O(L · (V+E) log E)；不物化状态展开图，
 * 不引入第三方依赖。
 *
 * @param layers 有序的模态层序列：`layers[0]` 为起始模态，`layers[layers.length-1]` 为终止模态。
 * @param links 换乘链接；只有相邻层之间（`layers[i]` → `layers[i+1]`）的链接会被使用。
 * @param startNodeId 起点节点 id，必须存在于 `layers[0].graph`。
 * @param endNodeId 终点节点 id，必须存在于末层图。
 * @param options `metric` 取 `'distance'`（默认）或 `'time'`。
 * @returns 跨模态路径（分段 + 换乘记录）；不可达返回 `{ cost: Infinity, segments: [], transfers: [] }`。
 * @throws layers 为空、起点不在首层图、终点不在末层图、或换乘罚时非法时抛错。
 */
export function multimodalDijkstra(
  layers: readonly ModalLayer[],
  links: readonly TransferLink[],
  startNodeId: number,
  endNodeId: number,
  options?: { metric?: 'distance' | 'time' },
): MultiModalPath {
  const metric = options?.metric ?? 'distance';
  if (layers.length === 0) {
    throw new Error('multimodalDijkstra: layers 不能为空，至少需要一个交通模态层');
  }
  const firstLayer = layers[0]!;
  const lastLayer = layers[layers.length - 1]!;
  if (!firstLayer.graph.hasNode(startNodeId)) {
    throw new Error(
      `multimodalDijkstra: 起点节点 ${startNodeId} 不在起始模态 ${firstLayer.mode} 的路网中`,
    );
  }
  if (!lastLayer.graph.hasNode(endNodeId)) {
    throw new Error(
      `multimodalDijkstra: 终点节点 ${endNodeId} 不在终止模态 ${lastLayer.mode} 的路网中`,
    );
  }
  for (const link of links) {
    if (!Number.isFinite(link.penaltySeconds) || link.penaltySeconds < 0) {
      throw new Error(
        `multimodalDijkstra: 换乘点 ${link.transferPointId} 的 penaltySeconds 非法: ${link.penaltySeconds}`,
      );
    }
  }

  // 边界 i（第 i 层 → 第 i+1 层）可用的换乘链接：仅相邻层之间，其余一律忽略。
  const boundaryLinks: TransferLink[][] = [];
  for (let i = 0; i + 1 < layers.length; i++) {
    const from = layers[i]!.mode;
    const to = layers[i + 1]!.mode;
    boundaryLinks.push(links.filter((l) => l.fromMode === from && l.toMode === to));
  }

  // 逐层推进：每层以“上一层各换乘入口节点 + 到达代价”为多源做层内最短路。
  const plans: LayerPlan[] = [];
  let sources = new Map<number, number>([[startNodeId, 0]]);

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    const isLast = i === layers.length - 1;
    const linksHere = isLast ? [] : boundaryLinks[i]!;
    const targets = new Set<number>(isLast ? [endNodeId] : linksHere.map((l) => l.fromNodeId));
    const search = searchLayer(layer, sources, targets);

    if (isLast) {
      if (!search.best.has(endNodeId)) {
        return { cost: Infinity, segments: [], transfers: [] };
      }
      plans.push({ search, next: new Map() });
      break;
    }

    // 本层到下一层的换乘候选：对每个下一层入口节点取全局最小代价（不做贪心）。
    const next = new Map<number, { link: TransferLink; cost: number }>();
    for (const link of linksHere) {
      const d = search.best.get(link.fromNodeId);
      if (d === undefined) continue;
      const cost = d + (metric === 'time' ? link.penaltySeconds : 0);
      const cur = next.get(link.toNodeId);
      if (cur === undefined || cost < cur.cost) {
        next.set(link.toNodeId, { link, cost });
      }
    }
    if (next.size === 0) {
      return { cost: Infinity, segments: [], transfers: [] };
    }
    plans.push({ search, next });

    const nextSources = new Map<number, number>();
    for (const [node, entry] of next) nextSources.set(node, entry.cost);
    sources = nextSources;
  }

  // 反向回溯：由末层的目标节点沿“上一层选定的换乘链接”回退到起点。
  const segments: MultiModalSegment[] = [];
  const transfers: TransferUsage[] = [];
  /** 各边界（第 i 层 → 第 i+1 层）实际使用的换乘链接。 */
  const boundaryChosen: (TransferLink | undefined)[] = new Array(layers.length - 1).fill(undefined);

  let layerIndex = layers.length - 1;
  let targetNode = endNodeId;
  while (layerIndex >= 0) {
    const layer = layers[layerIndex]!;
    const plan = plans[layerIndex]!;
    const seg = reconstructSegment(plan.search, layer.graph, targetNode);
    if (seg === undefined) {
      return { cost: Infinity, segments: [], transfers: [] };
    }
    const segment: MultiModalSegment = {
      mode: layer.mode,
      cost: seg.cost,
      nodeIds: seg.nodeIds,
      edgeIds: seg.edgeIds,
    };
    if (layerIndex > 0) {
      // 本段起点即上一层选定的换乘入口节点，由此定出该边界使用的换乘链接。
      const chosen = plans[layerIndex - 1]!.next.get(seg.nodeIds[0]!);
      if (chosen === undefined) {
        return { cost: Infinity, segments: [], transfers: [] };
      }
      boundaryChosen[layerIndex - 1] = chosen.link;
      segment.fromTransferPoint = chosen.link.transferPointId;
      transfers.unshift({
        transferPointId: chosen.link.transferPointId,
        fromMode: chosen.link.fromMode,
        toMode: chosen.link.toMode,
        fromNodeId: chosen.link.fromNodeId,
        toNodeId: chosen.link.toNodeId,
        penaltySeconds: chosen.link.penaltySeconds,
      });
      targetNode = chosen.link.fromNodeId;
    }
    segments.unshift(segment);
    layerIndex--;
  }

  // 除首段外，每段的终点都是一次换乘的落点；末段终点转换点缺省。
  for (let i = 0; i + 1 < layers.length; i++) {
    const link = boundaryChosen[i];
    if (link !== undefined) segments[i]!.toTransferPoint = link.transferPointId;
  }

  const total = plans[plans.length - 1]!.search.best.get(endNodeId)!;
  return { cost: total, segments, transfers };
}

import type { RoadEdge } from '@gisalgo/shared';
import { haversine } from './graph.js';
import type { EdgeWeightFn } from './dijkstra.js';
import type { ReadonlyAdjacency } from './adjacency-view.js';

/** way 属性边界查询：两条道路的相关属性（等级/限速/方向/权限）不同则须断链。C 的 `CompressionWayIndex` 满足此接口。 */
export interface WayBoundaryQuery {
  hasBoundary(firstWayId: number, secondWayId: number): boolean;
}

/** 压缩图的边：原图有向边序列的捷径，或未压缩的原图单边。 */
export interface CompressedEdge extends RoadEdge {
  /** 原图有向边 id 序列（from → to）；未压缩原边为仅含自身的单元素数组。 */
  originalEdgeIds: number[];
  /** 距离口径：Σ 原边 Haversine 长度（米），构造时预计算。 */
  distance: number;
}

/** 压缩路径还原结果：原图节点/边序列，与 PathResult 的 nodeIds/edgeIds 同口径。 */
export interface CompressedPath {
  nodeIds: number[];
  edgeIds: number[];
}

/** 压缩统计；节点数/边数均按原口径（边数=有向边，与 /api/health 的 edgeCount 一致）。 */
export interface CompressionStats {
  originalNodeCount: number;
  originalEdgeCount: number;
  compressedNodeCount: number;
  compressedEdgeCount: number;
  /** 被压缩掉的节点数 = originalNodeCount - compressedNodeCount。 */
  contractedNodeCount: number;
  /** 节点压缩比（0..1）：1 - 压缩后节点数 / 原节点数。 */
  nodeReduction: number;
  /** 边压缩比（0..1）：1 - 压缩后有向边数 / 原有向边数。 */
  edgeReduction: number;
}

/** compressTopology 的输入。 */
export interface CompressionInput {
  /** 原图节点：id → [lat, lon]。 */
  nodes: ReadonlyMap<number, readonly [number, number]>;
  /** 原图有向边。 */
  edges: readonly RoadEdge[];
  /** 语义保留节点（禁转 via + 换乘端点），命中即不压缩。 */
  protectedNodes: ReadonlySet<number>;
  /** 属性链边界查询。 */
  wayBoundary: WayBoundaryQuery;
}

/**
 * 压缩图：保留节点 + 压缩边，满足 `ReadonlyAdjacency`，可直接供禁转/多模态寻路使用。
 *
 * 边 id 命名：未压缩原边保留原边 id；跨链压缩边使用大于所有原边 id 的新 id。
 * 每条压缩边都带 `originalEdgeIds`，因此「是否被压缩」无需额外判定，`expandEdgeIds`
 * 对两种边统一展开即可。
 */
export class CompressedGraph implements ReadonlyAdjacency {
  private readonly coords = new Map<number, [number, number]>();
  private readonly outAdj = new Map<number, CompressedEdge[]>();
  private readonly edgeById = new Map<number, CompressedEdge>();
  private readonly originalEdgeById = new Map<number, RoadEdge>();
  readonly stats: CompressionStats;

  constructor(
    keptNodes: ReadonlyMap<number, readonly [number, number]>,
    compressedEdges: readonly CompressedEdge[],
    originalEdges: ReadonlyMap<number, RoadEdge>,
    stats: CompressionStats,
  ) {
    this.stats = stats;
    for (const [id, c] of keptNodes) this.coords.set(id, [c[0], c[1]]);
    for (const e of compressedEdges) {
      this.edgeById.set(e.id, e);
      const list = this.outAdj.get(e.from);
      if (list === undefined) this.outAdj.set(e.from, [e]);
      else list.push(e);
    }
    for (const [id, e] of originalEdges) this.originalEdgeById.set(id, e);
  }

  hasNode(id: number): boolean {
    return this.coords.has(id);
  }

  nodes(): IterableIterator<number> {
    return this.coords.keys();
  }

  outEdges(id: number): readonly CompressedEdge[] {
    return this.outAdj.get(id) ?? [];
  }

  edge(id: number): CompressedEdge | undefined {
    return this.edgeById.get(id);
  }

  coordinates(id: number): readonly [number, number] | undefined {
    return this.coords.get(id);
  }

  /** 原图边查询（供逐原边权重累计与路径还原）。 */
  originalEdge(id: number): RoadEdge | undefined {
    return this.originalEdgeById.get(id);
  }

  /** 压缩边序列 → 原图有向边序列（按序展开拼接）。 */
  expandEdgeIds(compressedEdgeIds: readonly number[]): number[] {
    const out: number[] = [];
    for (const id of compressedEdgeIds) {
      const e = this.edgeById.get(id);
      if (e === undefined) throw new Error(`压缩边不存在: ${id}`);
      out.push(...e.originalEdgeIds);
    }
    return out;
  }

  /**
   * 压缩路径 → 原图路径。原图节点序列由原边端点重建（首边起点 + 各边末端），
   * 保证与原图逐边一致；共享的原图节点自然只出现一次。
   */
  expandPath(
    compressedNodeIds: readonly number[],
    compressedEdgeIds: readonly number[],
  ): CompressedPath {
    const edgeIds = this.expandEdgeIds(compressedEdgeIds);
    if (edgeIds.length === 0) return { nodeIds: [...compressedNodeIds], edgeIds: [] };
    const first = this.originalEdgeById.get(edgeIds[0]!);
    if (first === undefined) throw new Error(`原图边不存在: ${edgeIds[0]}`);
    const nodeIds: number[] = [first.from];
    for (const eid of edgeIds) {
      const oe = this.originalEdgeById.get(eid);
      if (oe === undefined) throw new Error(`原图边不存在: ${eid}`);
      nodeIds.push(oe.to);
    }
    return { nodeIds, edgeIds };
  }
}

/**
 * 由原图边权函数构造压缩图边权函数：对压缩边逐原边求权再求和。
 *
 * 这是作业三「时间口径逐原边算时间再求和」的正确实现，避免「先平均速度再乘总长」
 * 把属性差异摊平。距离口径可直接用 `CompressedEdge.distance`（Σ 原边 Haversine，
 * 构造时预计算，O(1)）。
 */
export function compressEdgeWeight(
  graph: CompressedGraph,
  originalWeight: EdgeWeightFn,
): (edge: CompressedEdge) => number {
  return (edge) => {
    let sum = 0;
    for (const eid of edge.originalEdgeIds) {
      const oe = graph.originalEdge(eid);
      if (oe === undefined) return Infinity;
      const w = originalWeight(oe);
      if (!Number.isFinite(w)) return Infinity;
      sum += w;
    }
    return sum;
  };
}

/**
 * 度-2 节点压缩：把连续直行路段合并为压缩边，产出压缩图与原图↔压缩图双向映射。
 *
 * ## 判定口径（issue #63 §3.2）
 *
 * 度-2 用**去重后的邻居数**判定：`N(v) = { w | 存在边 v→w 或 w→v }`，`|N(v)| == 2`
 * 才是可压缩中间点。双向道路的普通中间点有向度 = 4（入 2 出 2）但邻居数 = 2，
 * 故不直接使用有向度统计。
 *
 * ## 保留集（命中即不压缩）
 *
 * 1. 语义保留节点（禁转 via / 换乘端点）：由调用方传入 `protectedNodes`；
 * 2. 属性变化点：入边 way 与出边 way 的 `wayBoundary.hasBoundary` 为真处；
 * 3. 方向模式变化点：节点的入/出方向不是「干净直通」（单向直通或双向直通）——
 *    分叉/汇合/死端等一律保留；
 * 4. 链端点：去重邻居数 ≠ 2 的节点天然不满足度-2 判定。
 *
 * 压缩后纯环（诱导度均为 2 的连通分量）整体保留，避免自环捷径与信息丢失。
 *
 * ## 压缩边与还原
 *
 * 从每个保留节点的每条出边出发，沿可压缩节点「直通」到下一个保留节点，串成一条
 * 压缩边；压缩边记录 `originalEdgeIds`（原图有向边序列）、起止原图节点与 Σ 原边长度。
 * 压缩图路径经 `CompressedGraph.expandPath` 展开为原图边序列并重建节点序列。
 *
 * @param input 原图拓扑 + 语义保留集 + 属性边界查询。
 * @returns 压缩图（含统计与映射）。纯函数：禁转增删导致的保留集变化由调用方以
 *   `(mode, 禁转版本号)` 为键缓存失效并重建，本函数不缓存、不持久化。
 */
export function compressTopology(input: CompressionInput): CompressedGraph {
  const { nodes, edges, protectedNodes, wayBoundary } = input;

  // 有向邻接 + 去重邻居。
  const outAdj = new Map<number, RoadEdge[]>();
  const inAdj = new Map<number, RoadEdge[]>();
  const neighbors = new Map<number, Set<number>>();
  const addNeighbor = (map: Map<number, Set<number>>, from: number, to: number): void => {
    let s = map.get(from);
    if (s === undefined) {
      s = new Set();
      map.set(from, s);
    }
    s.add(to);
  };
  for (const e of edges) {
    let ol = outAdj.get(e.from);
    if (ol === undefined) {
      ol = [];
      outAdj.set(e.from, ol);
    }
    ol.push(e);
    let il = inAdj.get(e.to);
    if (il === undefined) {
      il = [];
      inAdj.set(e.to, il);
    }
    il.push(e);
    addNeighbor(neighbors, e.from, e.to);
    addNeighbor(neighbors, e.to, e.from);
  }

  /** 方向是否「干净直通」：单向直通（恰一入一出入≠出）或双向直通（入=出={两邻居}）。 */
  const isCleanThrough = (v: number): boolean => {
    const inN = new Set<number>();
    for (const e of inAdj.get(v) ?? []) inN.add(e.from);
    const outN = new Set<number>();
    for (const e of outAdj.get(v) ?? []) outN.add(e.to);
    const inArr = [...inN];
    const outArr = [...outN];
    const oneWay = inArr.length === 1 && outArr.length === 1 && inArr[0] !== outArr[0];
    const biDir =
      inArr.length === 2 && outArr.length === 2 && inArr.every((x) => outN.has(x));
    return oneWay || biDir;
  };

  /** 节点是否位于属性边界（任一入边 way 与任一入边 way 属性不同）。 */
  const hasAttributeBoundary = (v: number): boolean => {
    const inWays = new Set<number>();
    for (const e of inAdj.get(v) ?? []) inWays.add(e.wayId);
    const outWays = new Set<number>();
    for (const e of outAdj.get(v) ?? []) outWays.add(e.wayId);
    for (const a of inWays) for (const b of outWays) if (wayBoundary.hasBoundary(a, b)) return true;
    return false;
  };

  const contractible = new Set<number>();
  for (const [v, nb] of neighbors) {
    if (nb.size !== 2) continue;
    if (protectedNodes.has(v)) continue;
    if (!isCleanThrough(v)) continue;
    if (hasAttributeBoundary(v)) continue;
    contractible.add(v);
  }

  // 断开纯环：诱导度均为 2 的连通分量整体保留，避免产生自环捷径。
  {
    const induced = new Map<number, number[]>();
    for (const v of contractible) {
      const adj: number[] = [];
      for (const w of neighbors.get(v)!) if (contractible.has(w)) adj.push(w);
      induced.set(v, adj);
    }
    const seen = new Set<number>();
    for (const v of contractible) {
      if (seen.has(v)) continue;
      const comp: number[] = [];
      const stack = [v];
      seen.add(v);
      let allDegreeTwo = true;
      while (stack.length > 0) {
        const u = stack.pop()!;
        comp.push(u);
        const adj = induced.get(u) ?? [];
        if (adj.length !== 2) allDegreeTwo = false;
        for (const w of adj) if (!seen.has(w)) {
          seen.add(w);
          stack.push(w);
        }
      }
      if (allDegreeTwo) for (const u of comp) contractible.delete(u);
    }
  }

  const keptNodes = new Map<number, [number, number]>();
  for (const [id, c] of nodes) if (!contractible.has(id)) keptNodes.set(id, [c[0], c[1]]);

  const originalEdgeById = new Map<number, RoadEdge>();
  let nextId = 0;
  for (const e of edges) {
    originalEdgeById.set(e.id, e);
    if (e.id >= nextId) nextId = e.id + 1;
  }
  const edgeLength = (e: RoadEdge): number => haversine(nodes.get(e.from)!, nodes.get(e.to)!);

  // 沿直通链串压缩边。
  const compressedEdges: CompressedEdge[] = [];
  const visitedEdge = new Set<number>();
  for (const u of keptNodes.keys()) {
    for (const e of outAdj.get(u) ?? []) {
      if (visitedEdge.has(e.id)) continue;
      const chain: RoadEdge[] = [e];
      visitedEdge.add(e.id);
      let prev = u;
      let cur = e.to;
      while (contractible.has(cur)) {
        let next: RoadEdge | undefined;
        for (const oe of outAdj.get(cur) ?? []) {
          if (oe.to !== prev) {
            next = oe;
            break;
          }
        }
        if (next === undefined || visitedEdge.has(next.id)) break;
        chain.push(next);
        visitedEdge.add(next.id);
        prev = cur;
        cur = next.to;
      }
      let distance = 0;
      for (const ce of chain) distance += edgeLength(ce);
      compressedEdges.push({
        id: nextId++,
        from: u,
        to: cur,
        wayId: chain[0]!.wayId,
        originalEdgeIds: chain.map((ce) => ce.id),
        distance,
      });
    }
  }

  const stats: CompressionStats = {
    originalNodeCount: nodes.size,
    originalEdgeCount: edges.length,
    compressedNodeCount: keptNodes.size,
    compressedEdgeCount: compressedEdges.length,
    contractedNodeCount: nodes.size - keptNodes.size,
    nodeReduction: nodes.size === 0 ? 0 : 1 - keptNodes.size / nodes.size,
    edgeReduction: edges.length === 0 ? 0 : 1 - compressedEdges.length / edges.length,
  };

  return new CompressedGraph(keptNodes, compressedEdges, originalEdgeById, stats);
}

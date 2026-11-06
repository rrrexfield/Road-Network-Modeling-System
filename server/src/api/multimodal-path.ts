/**
 * 跨模态路径求解(作业二 issue #34):在多个交通模态的子图之间按转换点换乘,
 * 求出「驾车 → 步行」这类跨模态路径,并按冻结契约 `PathResult.segments` 分段返回。
 *
 * 口径(与 shared 的契约决策一致):
 * - `PathResult.distance` 为各段代价之和;**换乘罚时(等待 + 接驳步行)不计入 distance**,
 *   改由 `transferPenaltySeconds` 单独下发,避免"距离"这一字段混入时间口径;
 * - 段内边 id 只在所属模态内有效,跨段不可复用,故跨模态时顶层 `edgeIds` 留空,
 *   由 `segments[i].edgeIds` 承担;
 * - 节点 id 是 OSM 节点 id,跨模态通用,故顶层 `nodeIds` 可以是各段节点序列的拼接。
 */
import type { PathSegment, PathResponse, TravelMode, WeightProfile } from '@gisalgo/shared';
import type { LoadedNetwork } from '../io/loader.js';
import { multimodalDijkstra, type ModalLayer, type TransferLink } from '../graph/index.js';
import { createModeEdgeWeight } from '../weights/index.js';
import type { ModalRuntimeRegistry } from './modal-runtime.js';

/**
 * 把经纬度吸附到最近的图节点。
 *
 * 线性扫描全部节点:武汉数据 62.8 万节点,实测在毫秒级,满足演示需要。
 * 若后续成为瓶颈,可替换为 G3 的空间索引。
 */
export function snapToNode(
  graph: { nodes(): IterableIterator<number>; coordinates(id: number): readonly [number, number] | undefined },
  lon: number,
  lat: number,
): number | null {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const id of graph.nodes()) {
    const c = graph.coordinates(id);
    if (c === undefined) continue;
    // c 是 [lat, lon];经度差要乘 cos(lat) 才能和纬度差同尺度比较
    const dy = c[0] - lat;
    const dx = (c[1] - lon) * cosLat;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/**
 * 解析 `modes` 查询参数:逗号分隔的**有序**交通模态序列。
 *
 * @param raw 查询串原始值。
 * @returns 规范化后的模态序列(去重、保持顺序);非法值返回 null。
 * @remarks 空串、未知模态、类型不符一律判非法;去重后长度可能小于 2,
 * 由调用方决定如何报错。
 */
export function parseModeSequence(raw: unknown): TravelMode[] | null {
  if (typeof raw !== 'string') return null;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return null;
  const modes: TravelMode[] = [];
  for (const part of parts) {
    if (part !== 'car' && part !== 'walk' && part !== 'bike' && part !== 'bus') return null;
    if (!modes.includes(part)) modes.push(part);
  }
  return modes;
}

/** 跨模态路径求解的依赖。 */
export interface MultimodalPathDeps {
  /** 多模态运行时注册表(提供各模态的图与禁转服务)。 */
  registry: ModalRuntimeRegistry;
  /** 装载后的路网(节点坐标表与转换点数据)。 */
  network: LoadedNetwork;
  /** 权重配置(优化目标与限速覆盖)。 */
  profile: WeightProfile;
}

/** 跨模态路径结果。 */
export interface MultimodalPathResult {
  /** 响应体。 */
  body: PathResponse;
  /** 换乘罚时合计(秒);单模态为 0。 */
  transferPenaltySeconds: number;
  /** 换乘次数。 */
  transferCount: number;
}

/**
 * 求跨模态路径。
 *
 * @param modes 有序模态序列(至少两个),例如 ['car', 'walk']。
 * @param from 起点 [lon, lat]。
 * @param to 终点 [lon, lat]。
 * @param deps 运行时、原始路网与权重配置。
 * @returns 路径结果;不可达(或无可用换乘连接)时返回 null。
 * @remarks 起点在首模态图上吸附,终点在末模态图上吸附——**两端各用自己的模态**,
 * 这正是跨模态的意义(驾车到停车场,再步行到目的地)。层内搜索沿用 B 的禁转判定,
 * 换乘边来自 A 的转换点连接表(证据类型随连接保留)。
 */
export function findMultimodalPath(
  modes: readonly TravelMode[],
  from: readonly [number, number],
  to: readonly [number, number],
  deps: MultimodalPathDeps,
): MultimodalPathResult | null {
  if (modes.length < 2) return null;

  const runtimes = deps.registry.runtimes([...modes]);
  const nodeTables: Partial<Record<TravelMode, ReadonlyMap<number, readonly [number, number]>>> =
    {};
  for (let i = 0; i < modes.length; i++) {
    nodeTables[modes[i]!] = runtimes[i]!.topology.nodes;
  }

  // 换乘连接表由注册表按模态集合缓存(实测武汉全量构建约 4 s,故必须缓存);
  // 这里传入本次已构建好的节点表,避免 LRU 淘汰导致重复构图。
  const links = deps.registry.transferLinks(modes, nodeTables);

  const layers: ModalLayer[] = modes.map((mode, index) => {
    const runtime = runtimes[index]!;
    return {
      mode,
      graph: runtime.graph,
      weight: createModeEdgeWeight(
        { nodes: deps.network.nodes, wayHighway: runtime.wayHighway },
        mode,
        deps.profile,
      ),
      // 禁转边对只在所属模态内有效,故每层用自己的禁转服务。
      isTurnForbidden: (via, fromEdge, toEdge) => runtime.service.isForbidden(via, fromEdge, toEdge),
    };
  });

  const startId = snapToNode(layers[0]!.graph, from[0], from[1]);
  const endId = snapToNode(layers[layers.length - 1]!.graph, to[0], to[1]);
  if (startId === null || endId === null) return null;

  const searchLinks: TransferLink[] = links.map((link) => ({
    fromMode: link.fromMode,
    fromNodeId: link.fromNodeId,
    toMode: link.toMode,
    toNodeId: link.toNodeId,
    penaltySeconds: link.penaltySeconds,
    transferPointId: link.transferPointId,
  }));

  const result = multimodalDijkstra(layers, searchLinks, startId, endId, {
    metric: deps.profile.metric,
  });
  if (!Number.isFinite(result.cost) || result.segments.length === 0) return null;

  const segments: PathSegment[] = result.segments.map((segment, index) => {
    const layer = layers.find((item) => item.mode === segment.mode) ?? layers[index]!;
    const coordinates: [number, number][] = [];
    for (const nodeId of segment.nodeIds) {
      const coord = layer.graph.coordinates(nodeId);
      if (coord !== undefined) coordinates.push([coord[1], coord[0]]);
    }
    const out: PathSegment = {
      mode: segment.mode,
      distance: segment.cost,
      nodeIds: segment.nodeIds,
      edgeIds: segment.edgeIds,
      coordinates,
    };
    if (segment.fromTransferPoint !== undefined) out.fromTransferPoint = segment.fromTransferPoint;
    if (segment.toTransferPoint !== undefined) out.toTransferPoint = segment.toTransferPoint;
    return out;
  });

  const nodeIds: number[] = [];
  const coordinates: [number, number][] = [];
  let distance = 0;
  for (const segment of segments) {
    nodeIds.push(...segment.nodeIds);
    for (const point of segment.coordinates) {
      const last = coordinates[coordinates.length - 1];
      if (last !== undefined && last[0] === point[0] && last[1] === point[1]) continue;
      coordinates.push(point);
    }
    distance += segment.distance;
  }

  const startCoord = layers[0]!.graph.coordinates(startId);
  const endCoord = layers[layers.length - 1]!.graph.coordinates(endId);
  if (startCoord === undefined || endCoord === undefined) return null;

  const transferPenaltySeconds = result.transfers.reduce(
    (total, transfer) => total + transfer.penaltySeconds,
    0,
  );

  const body: PathResponse = {
    distance,
    nodeIds,
    // 段内边 id 只在所属模态内有效,顶层不给出跨模态的边序列。
    edgeIds: [],
    from: [startCoord[1], startCoord[0]],
    to: [endCoord[1], endCoord[0]],
    coordinates,
    segments,
    transferPenaltySeconds,
  };

  return { body, transferPenaltySeconds, transferCount: result.transfers.length };
}

import type { TravelMode } from '@gisalgo/shared';
import type { TransferPointData } from '../io/index.js';
import { matchTransferConnections } from './transfer-connections.js';
import type { TransferEntranceReport } from './transfer-entrances.js';
import type { TopologyResult } from './build-topology.js';

type Position = readonly [number, number];
type Network = Pick<TopologyResult, 'nodes' | 'edges'>;

/** 调用方核验过的接驳路径，按设施入口→道路节点排列，[lon,lat]。 */
export interface TransferAttachmentReview {
  pointId: number;
  mode: TravelMode;
  nodeId: number;
  accessPath: readonly Position[];
  /** 核验记录链接或记录编号；不接受空记录，也不自动认可候选。 */
  reference: string;
}

export type TransferAttachment =
  | {
      status: 'available';
      nodeId: number;
      distanceM: number;
      accessPath: [number, number][];
      incomingEdgeIds: number[];
      outgoingEdgeIds: number[];
      reviewReference: string;
    }
  | { status: 'unavailable'; reason: string; candidateNodeId?: number; distanceM?: number };

export type TransferAttachmentIndex = Map<number, Partial<Record<TravelMode, TransferAttachment>>>;

function valid(p: Position): boolean {
  return (
    Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90
  );
}
function same(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
function length(path: readonly Position[]): number {
  let meters = 0;
  const rad = Math.PI / 180;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!,
      b = path[i]!;
    const h =
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
      Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
    meters += 12742000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }
  return meters;
}

/**
 * 将候选整理为B可消费的逐模式接驳表；只有显式核验记录才可用。
 * @param limits 各模式接驳路径长度上限（米），调用方须显式确定，不内置可通行假设。
 * @param reviews 核验后的设施入口至道路节点路径；区域入口必须来自entrances证据。
 * @remarks 不验证核验者身份或沿线物理许可；调用方负责实景/地图核验并保留reference。
 * 对照当前图校验端点、路径长度与有向入出边；不缓存edgeId、不修改图、不创建搜索边。
 */
export function buildTransferAttachments(
  data: TransferPointData,
  networks: Partial<Record<TravelMode, Network>>,
  limits: Record<TravelMode, number>,
  reviews: readonly TransferAttachmentReview[] = [],
  entrances?: TransferEntranceReport,
): TransferAttachmentIndex {
  for (const mode of ['car', 'walk', 'bike', 'bus'] as const)
    if (!Number.isFinite(limits[mode]) || limits[mode] < 0 || limits[mode] > 1000)
      throw new Error('接驳阈值须为0–1000米');
  const points = new Map(data.points.map((p) => [p.id, p]));
  const sources = new Map(data.sources.map((s) => [s.pointId, s]));
  if (points.size !== data.points.length || sources.size !== data.sources.length)
    throw new Error('转换点ID重复');
  if (data.points.some((p) => !sources.has(p.id))) throw new Error('转换点缺少来源');
  const reviewMap = new Map<string, TransferAttachmentReview>();
  for (const r of reviews) {
    const key = `${r.pointId}:${r.mode}`;
    if (!points.has(r.pointId) || !sources.get(r.pointId)?.modes.includes(r.mode))
      throw new Error('核验记录引用未知转换点或模式');
    if (reviewMap.has(key)) throw new Error('同一转换点模式有多个核验记录');
    reviewMap.set(key, r);
  }
  const nodes = Object.fromEntries(Object.entries(networks).map(([m, n]) => [m, n.nodes]));
  const candidateMap = new Map<string, { nodeId?: number; distanceM?: number; reason: string }>();
  // 各模式使用各自阈值，诊断不构造可通行连接。
  for (const mode of ['car', 'walk', 'bike', 'bus'] as const) {
    const subset = {
      ...data,
      sources: data.sources.map((s) => ({ ...s, modes: s.modes.filter((m) => m === mode) })),
    };
    const report = matchTransferConnections(subset, nodes, limits[mode]);
    for (const m of report.matches)
      candidateMap.set(`${m.pointId}:${mode}`, {
        nodeId: m.nodeId,
        distanceM: m.distanceM,
        reason: 'review-required',
      });
    for (const u of report.unresolved)
      if (u.mode === mode) candidateMap.set(`${u.pointId}:${mode}`, { reason: u.reason });
  }
  const result: TransferAttachmentIndex = new Map();
  const selected = new Map<TravelMode, Set<number>>();
  for (const r of reviews) {
    const ids = selected.get(r.mode) ?? new Set<number>();
    ids.add(r.nodeId);
    selected.set(r.mode, ids);
  }
  const directions = new Map<string, { incomingEdgeIds: number[]; outgoingEdgeIds: number[] }>();
  for (const [mode, graph] of Object.entries(networks) as [TravelMode, Network][]) {
    const ids = selected.get(mode);
    if (!ids) continue;
    for (const id of ids)
      directions.set(`${mode}:${id}`, { incomingEdgeIds: [], outgoingEdgeIds: [] });
    for (const edge of graph.edges) {
      if (ids.has(edge.to)) directions.get(`${mode}:${edge.to}`)!.incomingEdgeIds.push(edge.id);
      if (ids.has(edge.from)) directions.get(`${mode}:${edge.from}`)!.outgoingEdgeIds.push(edge.id);
    }
  }
  for (const point of data.points) {
    const source = sources.get(point.id);
    const row: Partial<Record<TravelMode, TransferAttachment>> = {};
    result.set(point.id, row);
    for (const mode of new Set(source?.modes ?? [])) {
      const r = reviewMap.get(`${point.id}:${mode}`);
      const graph = networks[mode];
      const unavailable = (reason: string): void => {
        row[mode] = { status: 'unavailable', reason };
      };
      if (!graph) {
        unavailable('mode-not-loaded');
        continue;
      }
      if (!r) {
        const c = candidateMap.get(`${point.id}:${mode}`);
        row[mode] = {
          status: 'unavailable',
          reason:
            source!.sourceType === 'way'
              ? 'entrance-review-required'
              : (c?.reason ?? 'review-required'),
          ...(c?.nodeId === undefined ? {} : { candidateNodeId: c.nodeId, distanceM: c.distanceM }),
        };
        continue;
      }
      const p = graph.nodes.get(r.nodeId);
      if (!p) {
        unavailable('node-not-on-mode-graph');
        continue;
      }
      if (!r.reference.trim() || !r.accessPath.length || !r.accessPath.every(valid)) {
        unavailable('invalid-review');
        continue;
      }
      if (!same(r.accessPath.at(-1)!, [p[1], p[0]])) {
        unavailable('source-geometry-changed');
        continue;
      }
      const start = r.accessPath[0]!;
      if (
        source!.sourceType === 'node'
          ? !same(start, point.position)
          : !entrances?.entrances.some(
              (e) => e.pointId === point.id && e.modes.includes(mode) && same(e.position, start),
            )
      ) {
        unavailable('entrance-evidence-missing');
        continue;
      }
      const distanceM = length(r.accessPath);
      if (distanceM > limits[mode]) {
        row[mode] = { status: 'unavailable', reason: 'access-path-exceeds-threshold', distanceM };
        continue;
      }
      const dir = directions.get(`${mode}:${r.nodeId}`)!;
      if (!dir.incomingEdgeIds.length && !dir.outgoingEdgeIds.length) {
        unavailable('node-without-directed-edges');
        continue;
      }
      row[mode] = {
        status: 'available',
        nodeId: r.nodeId,
        distanceM,
        accessPath: r.accessPath.map((p) => [...p]),
        incomingEdgeIds: [...dir.incomingEdgeIds],
        outgoingEdgeIds: [...dir.outgoingEdgeIds],
        reviewReference: r.reference,
      };
    }
  }
  return result;
}

/** 调用方提供经核验的实际步行接驳距离、速度和等待秒数；返回秒，不计入PathResult.distance。 */
export function computeTransferPenalty(input: {
  walkingDistanceM: number;
  walkingSpeedMps: number;
  waitingSeconds: number;
}): number {
  if (
    !Number.isFinite(input.walkingDistanceM) ||
    input.walkingDistanceM < 0 ||
    !Number.isFinite(input.walkingSpeedMps) ||
    input.walkingSpeedMps <= 0 ||
    !Number.isFinite(input.waitingSeconds) ||
    input.waitingSeconds < 0
  )
    throw new Error('换乘成本参数非法');
  const seconds = input.walkingDistanceM / input.walkingSpeedMps + input.waitingSeconds;
  if (!Number.isFinite(seconds)) throw new Error('换乘成本溢出');
  return seconds;
}

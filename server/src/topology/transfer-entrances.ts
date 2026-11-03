import type { TravelMode } from '@gisalgo/shared';
import type { TransferPointData, extractTransferPoints } from '../io/index.js';

type Raw = Parameters<typeof extractTransferPoints>[0];
type Nodes = ReadonlyMap<number, readonly [number, number]>;
export interface TransferEntranceReport {
  entrances: {
    pointId: number;
    sourceWayId: number;
    nodeId: number;
    position: [number, number];
    evidence: 'tagged-entrance' | 'shared-boundary-node';
    modes: TravelMode[];
    requiresReview: true;
  }[];
  issues: { pointId: number; nodeId?: number; mode?: TravelMode; reason: string }[];
}

/**
 * 以原区域way的边界节点代替展示中心，提取明确入口/共享路网节点的候选证据。
 * 不利用包围盒附近任意节点猜测入口，不建立转换边。返回位置均为[lon,lat]。
 * @remarks mode节点表应只含实际可通行边端点。标签和共享拓扑不能证明物理通行许可，
 * 所有结果仍需核验；无法匹配的显式入口也会保留为空modes候选并报告。
 */
export function inspectTransferEntrances(
  data: TransferPointData,
  raw: Raw,
  networks: Partial<Record<TravelMode, Nodes>>,
): TransferEntranceReport {
  const result: TransferEntranceReport = { entrances: [], issues: [] };
  const sources = data.sources.filter((s) => s.sourceType === 'way');
  const wantedWays = new Set(sources.map((s) => s.sourceId));
  const ways = new Map(raw.ways.filter((w) => wantedWays.has(w.id)).map((w) => [w.id, w]));
  const wantedNodes = new Set<number>();
  for (const way of ways.values()) for (const id of way.nds) wantedNodes.add(id);
  const nodes = new Map(raw.nodes.filter((n) => wantedNodes.has(n.id)).map((n) => [n.id, n]));
  for (const source of sources) {
    const pointId = source.pointId;
    const way = ways.get(source.sourceId);
    if (!way) {
      result.issues.push({ pointId, reason: 'source-way-missing' });
      continue;
    }
    let count = 0;
    for (const nodeId of new Set(way.nds)) {
      const node = nodes.get(nodeId);
      if (
        !node ||
        !Number.isFinite(node.lat) ||
        !Number.isFinite(node.lon) ||
        Math.abs(node.lat) > 90 ||
        Math.abs(node.lon) > 180
      ) {
        result.issues.push({ pointId, nodeId, reason: 'boundary-node-invalid' });
        continue;
      }
      const tags = Object.fromEntries(node.tags.map((t) => [t.k, t.v]));
      const tagged = ['yes', 'main', 'secondary', 'service'].includes(tags.entrance ?? '');
      const shared = source.modes.some((m) => networks[m]?.has(nodeId));
      if (!tagged && !shared) continue;
      if (
        ['no', 'private'].includes(tags.access ?? '') ||
        tags['access:conditional'] !== undefined ||
        (tags.barrier !== undefined && tags.barrier !== 'no') ||
        (tags.entrance !== undefined && !tagged)
      ) {
        result.issues.push({
          pointId,
          nodeId,
          reason: 'entrance-permission-or-barrier-unresolved',
        });
        continue;
      }
      const modes: TravelMode[] = [];
      for (const mode of new Set(source.modes)) {
        const graph = networks[mode];
        if (!graph) {
          result.issues.push({ pointId, nodeId, mode, reason: 'mode-not-loaded' });
          continue;
        }
        const p = graph.get(nodeId);
        if (!p) {
          result.issues.push({ pointId, nodeId, mode, reason: 'entrance-not-on-mode-graph' });
          continue;
        }
        if (p[0] !== node.lat || p[1] !== node.lon) {
          result.issues.push({ pointId, nodeId, mode, reason: 'source-geometry-changed' });
          continue;
        }
        const access =
          mode === 'walk'
            ? ['foot', 'access']
            : mode === 'bike'
              ? ['bicycle', 'vehicle', 'access']
              : mode === 'bus'
                ? ['bus', 'psv', 'motor_vehicle', 'vehicle', 'access']
                : ['motorcar', 'motor_vehicle', 'vehicle', 'access'];
        const value = access.map((k) => tags[k]).find((v) => v !== undefined);
        if (
          access.some((k) => tags[`${k}:conditional`] !== undefined) ||
          (value !== undefined && !['yes', 'designated', 'permissive'].includes(value))
        ) {
          result.issues.push({ pointId, nodeId, mode, reason: 'mode-access-unresolved' });
          continue;
        }
        modes.push(mode);
      }
      result.entrances.push({
        pointId,
        sourceWayId: source.sourceId,
        nodeId,
        position: [node.lon, node.lat],
        evidence: tagged ? 'tagged-entrance' : 'shared-boundary-node',
        modes,
        requiresReview: true,
      });
      count++;
    }
    if (!count) result.issues.push({ pointId, reason: 'no-supported-entrance-evidence' });
  }
  return result;
}

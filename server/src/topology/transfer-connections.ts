import type { TravelMode } from '@gisalgo/shared';
import type { TransferPointData } from '../io/index.js';

type Nodes = ReadonlyMap<number, readonly [number, number]>;
const CELL = 0.001;
const WIDTH = 360 / CELL;
const wrap = (x: number): number => ((x % WIDTH) + WIDTH) % WIDTH;
const positionValid = (lat: number, lon: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

function distance(a: readonly number[], b: readonly number[]): number {
  const rad = Math.PI / 180;
  const s =
    Math.sin(((b[0]! - a[0]!) * rad) / 2) ** 2 +
    Math.cos(a[0]! * rad) * Math.cos(b[0]! * rad) * Math.sin(((b[1]! - a[1]!) * rad) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, s))));
}

class NodeGrid {
  private readonly cells = new Map<string, number[]>();
  constructor(readonly nodes: Nodes) {
    for (const [id, p] of nodes) {
      if (!Number.isSafeInteger(id) || !positionValid(p[0], p[1]))
        throw new Error('模式节点数据非法');
      const key = `${Math.floor(p[0] / CELL)}:${wrap(Math.floor((p[1] + 180) / CELL))}`;
      const ids = this.cells.get(key) ?? [];
      ids.push(id);
      this.cells.set(key, ids);
    }
  }
  candidates(p: readonly [number, number], radius: number): number[] {
    // 110km/度作为保守包围范围，最终仍用球面距离筛选。
    const latSpan = radius / 110000;
    const cosine = Math.cos((Math.min(90, Math.abs(p[0]) + latSpan) * Math.PI) / 180);
    const lonSpan = cosine < 1e-6 ? 180 : Math.min(180, latSpan / cosine);
    const ymin = Math.floor((p[0] - latSpan) / CELL),
      ymax = Math.floor((p[0] + latSpan) / CELL);
    const xmin = Math.floor((p[1] + 180 - lonSpan) / CELL),
      xmax = Math.floor((p[1] + 180 + lonSpan) / CELL);
    if ((ymax - ymin + 1) * (xmax - xmin + 1) > 10000) return [...this.nodes.keys()];
    const result = new Set<number>();
    for (let y = ymin; y <= ymax; y++)
      for (let x = xmin; x <= xmax; x++) {
        for (const id of this.cells.get(`${y}:${wrap(x)}`) ?? []) result.add(id);
      }
    return [...result];
  }
}

export interface TransferConnectionReport {
  matches: {
    pointId: number;
    mode: TravelMode;
    nodeId: number;
    distanceM: number;
    evidence: 'shared-osm-node' | 'nearby-candidate';
  }[];
  unresolved: { pointId: number; mode?: TravelMode; reason: string }[];
}

/**
 * 为转换点匹配各模式的道路节点，保留证据，不生成任何跨模式连边。
 * @param data 原始转换点及其来源，不能只传不带来源的显示DTO。
 * @param networks 当前图版本各模式节点表（原始[lat,lon]，不是Float32副本）。
 * @param radiusM 近邻候选最大距离，0–1000米；缺省100米为待评审项目策略。
 * @returns 共享OSM节点证据、待核验近邻候选及未解决原因；不意味着换乘已获准。
 * @remarks 区域中心不作为入口；零距离不同ID仍是候选，不能据此跨越高架/围墙。
 */
export function matchTransferConnections(
  data: TransferPointData,
  networks: Partial<Record<TravelMode, Nodes>>,
  radiusM = 100,
): TransferConnectionReport {
  if (!Number.isFinite(radiusM) || radiusM < 0 || radiusM > 1000)
    throw new Error('候选半径须在0–1000米');
  const sources = new Map(data.sources.map((s) => [s.pointId, s]));
  if (sources.size !== data.sources.length) throw new Error('转换点来源ID重复');
  const grids = new Map<TravelMode, NodeGrid>();
  const result: TransferConnectionReport = { matches: [], unresolved: [] };
  for (const point of data.points) {
    const source = sources.get(point.id);
    if (!source) {
      result.unresolved.push({ pointId: point.id, reason: 'missing-source' });
      continue;
    }
    if (!positionValid(point.position[1], point.position[0])) throw new Error('转换点坐标非法');
    if (source.positionMethod !== 'osm-node' || source.sourceType !== 'node') {
      result.unresolved.push({ pointId: point.id, reason: 'entrance-required' });
      continue;
    }
    const p: readonly [number, number] = [point.position[1], point.position[0]];
    for (const mode of new Set(source.modes)) {
      const nodes = networks[mode];
      if (!nodes) {
        result.unresolved.push({ pointId: point.id, mode, reason: 'mode-not-loaded' });
        continue;
      }
      let grid = grids.get(mode);
      if (!grid) {
        grid = new NodeGrid(nodes);
        grids.set(mode, grid);
      }
      const exact = nodes.get(source.sourceId);
      if (exact) {
        if (exact[0] !== p[0] || exact[1] !== p[1]) {
          result.unresolved.push({ pointId: point.id, mode, reason: 'source-geometry-changed' });
          continue;
        }
        result.matches.push({
          pointId: point.id,
          mode,
          nodeId: source.sourceId,
          distanceM: 0,
          evidence: 'shared-osm-node',
        });
        continue;
      }
      let nearest: { id: number; d: number } | undefined;
      let secondDistance = Infinity;
      for (const id of grid.candidates(p, radiusM)) {
        const d = distance(p, nodes.get(id)!);
        if (d > radiusM) continue;
        if (!nearest || d < nearest.d) {
          secondDistance = nearest?.d ?? Infinity;
          nearest = { id, d };
        } else secondDistance = Math.min(secondDistance, d);
      }
      const tied = nearest !== undefined && secondDistance - nearest.d <= 1e-6;
      if (!nearest || tied) {
        result.unresolved.push({
          pointId: point.id,
          mode,
          reason: tied ? 'ambiguous-nearest' : 'no-node-within-radius',
        });
      } else
        result.matches.push({
          pointId: point.id,
          mode,
          nodeId: nearest.id,
          distanceM: nearest.d,
          evidence: 'nearby-candidate',
        });
    }
  }
  return result;
}

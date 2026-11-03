import type { TransferPoint, TravelMode } from '@gisalgo/shared';

interface OsmElement {
  id: number;
  tags: readonly { k: string; v: string }[];
}
interface TransferInput {
  nodes: readonly (OsmElement & { lat: number; lon: number })[];
  ways: readonly (OsmElement & { nds: readonly number[] })[];
}
export interface TransferPointData {
  points: TransferPoint[];
  sources: {
    pointId: number;
    sourceType: 'node' | 'way';
    sourceId: number;
    modes: TravelMode[];
    positionMethod: 'osm-node' | 'bounding-box-center';
  }[];
  issues: { sourceType: 'node' | 'way'; sourceId: number; reason: string }[];
}

function category(
  tags: Record<string, string>,
): { kind: TransferPoint['kind']; modes: TravelMode[] } | null {
  if (tags.amenity === 'parking') return { kind: 'parking', modes: ['car', 'walk'] };
  if (tags.amenity === 'bicycle_parking') return { kind: 'parking', modes: ['bike', 'walk'] };
  if (
    tags.highway === 'bus_stop' ||
    tags.amenity === 'bus_station' ||
    (tags.public_transport === 'platform' && tags.bus === 'yes')
  )
    return { kind: 'bus', modes: ['bus', 'walk'] };
  if (tags.station === 'subway' || (tags.railway === 'station' && tags.subway === 'yes')) {
    return { kind: 'subway', modes: ['walk'] };
  }
  return null;
}
const validPosition = (lat: number, lon: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/**
 * 从原始 OSM JSON 的节点/道路标签提取转换点标记，不修改输入、不建立换乘连接。
 * 节点ID映射为2*id，way映射为2*id+1，避免OSM不同元素命名空间碰撞；超安全整数则报告。
 * 区域/线状way用包围盒中心作展示代表点，不保证在区域内部，也不是已验证出入口。
 * 时间复杂度O(输入节点+输入道路标签+候选道路引用)，只为候选way收集坐标。
 */
export function extractTransferPoints(raw: TransferInput): TransferPointData {
  const result: TransferPointData = { points: [], sources: [], issues: [] };
  const used = new Set<number>();
  const candidates: { element: TransferInput['ways'][number]; tags: Record<string, string> }[] = [];
  const wantedNodes = new Set<number>();
  for (const element of raw.ways) {
    const tags = Object.fromEntries(element.tags.map((t) => [t.k, t.v]));
    if (!category(tags)) continue;
    candidates.push({ element, tags });
    for (const id of element.nds) wantedNodes.add(id);
  }
  const coordinates = new Map<number, readonly [number, number]>();
  function add(
    element: OsmElement,
    tags: Record<string, string>,
    sourceType: 'node' | 'way',
    position: [number, number] | null,
  ): void {
    const classification = category(tags);
    if (!classification) return;
    let reason: string | undefined;
    const id = 2 * element.id + (sourceType === 'way' ? 1 : 0);
    if (!Number.isSafeInteger(element.id) || element.id < 0 || !Number.isSafeInteger(id))
      reason = 'invalid-id';
    else if (used.has(id)) reason = 'duplicate-source';
    else if (['no', 'private'].includes(tags.access ?? '')) reason = 'access-denied';
    else if (tags['access:conditional'] !== undefined) reason = 'conditional-access';
    else if (!position || !validPosition(position[1], position[0]))
      reason = 'missing-or-invalid-position';
    if (reason) {
      result.issues.push({ sourceType, sourceId: element.id, reason });
      return;
    }
    used.add(id);
    const point: TransferPoint = { id, kind: classification.kind, position: position! };
    if (tags.name) point.name = tags.name;
    result.points.push(point);
    result.sources.push({
      pointId: id,
      sourceType,
      sourceId: element.id,
      modes: classification.modes,
      positionMethod: sourceType === 'node' ? 'osm-node' : 'bounding-box-center',
    });
  }
  for (const node of raw.nodes) {
    if (wantedNodes.has(node.id)) coordinates.set(node.id, [node.lat, node.lon]);
    const tags = Object.fromEntries(node.tags.map((t) => [t.k, t.v]));
    if (category(tags)) add(node, tags, 'node', [node.lon, node.lat]);
  }
  for (const { element, tags } of candidates) {
    const ids = new Set(element.nds);
    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;
    let valid = ids.size >= 2;
    for (const id of ids) {
      const p = coordinates.get(id);
      if (!p || !validPosition(p[0], p[1])) {
        valid = false;
        break;
      }
      minLat = Math.min(minLat, p[0]);
      maxLat = Math.max(maxLat, p[0]);
      minLon = Math.min(minLon, p[1]);
      maxLon = Math.max(maxLon, p[1]);
    }
    add(element, tags, 'way', valid ? [(minLon + maxLon) / 2, (minLat + maxLat) / 2] : null);
  }
  return result;
}

/** 按当前展示策略筛选转换点，返回独立副本；不是可换乘性或道路吸附判定。 */
export function getTransferPoints(data: TransferPointData, mode?: TravelMode): TransferPoint[] {
  if (mode !== undefined && !['car', 'walk', 'bike', 'bus'].includes(mode))
    throw new Error('未知交通模式');
  const included =
    mode === undefined
      ? null
      : new Set(data.sources.filter((s) => s.modes.includes(mode)).map((s) => s.pointId));
  return data.points
    .filter((p) => !included || included.has(p.id))
    .map((p) => ({ ...p, position: [...p.position] }));
}

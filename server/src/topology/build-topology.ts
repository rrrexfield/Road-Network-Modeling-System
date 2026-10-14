import type { RoadEdge, WayProperties } from '@gisalgo/shared';
import { resolveRoadDirection } from './direction.js';

/** C 模块内部输入；Graph 契约确认后由适配层转换。 */
export interface TopologyWay extends WayProperties {
  nds: readonly number[];
}

export interface TopologyIssue {
  code:
    | 'invalid-way-id'
    | 'duplicate-way-id'
    | 'short-way'
    | 'unsupported-direction'
    | 'missing-node'
    | 'invalid-node'
    | 'degenerate-segment';
  wayId: number;
  nodeId?: number;
  segmentIndex?: number;
}

export interface TopologyResult {
  nodes: Map<number, [number, number]>;
  edges: RoadEdge[];
  /** 原始道路属性（含 bridge/tunnel/layer）；边通过 wayId 引用，不保留 nds。 */
  ways: Map<number, WayProperties>;
  issues: TopologyIssue[];
}

/**
 * 按原始节点 ID 与相邻节点段构建有向边，不根据坐标交叉或重合新增连接。
 * @param sourceNodes OSM 节点 ID → [lat, lon]。
 * @param sourceWays 含原始节点顺序和标签的道路。
 * @returns 有效边端点、方向正确的边、道路属性和可定位的异常。
 * @remarks bridge/tunnel/layer 不决定单行，也不切断已有共享节点连接。
 * 缺失/非法端点只跳过涉及它的原始段，不跨缺口连线；未支持方向跳过整条道路。
 * 返回节点包含全部有效相邻段的端点，因此也包含原道路序列中的有效中间节点。
 * 输入顺序相同时边 ID 稳定；排序、过滤或规则变化后不保证跨版本稳定，不能作持久化身份。
 * 复杂度 O(道路数 + 引用节点数)。不做模式准入判断，输出不代表汽车可通行图。
 */
export function buildTopology(
  sourceNodes: ReadonlyMap<number, readonly [number, number]>,
  sourceWays: readonly TopologyWay[],
): TopologyResult {
  const result: TopologyResult = { nodes: new Map(), edges: [], ways: new Map(), issues: [] };

  for (const way of sourceWays) {
    if (!Number.isSafeInteger(way.id)) {
      result.issues.push({ code: 'invalid-way-id', wayId: way.id });
      continue;
    }
    if (result.ways.has(way.id)) {
      result.issues.push({ code: 'duplicate-way-id', wayId: way.id });
      continue;
    }
    const properties: WayProperties = { id: way.id, highway: way.highway, tags: { ...way.tags } };
    if (way.name !== undefined) properties.name = way.name;
    result.ways.set(way.id, properties);
    if (way.nds.length < 2) {
      result.issues.push({ code: 'short-way', wayId: way.id });
      continue;
    }
    const direction = resolveRoadDirection({ ...way.tags, highway: way.highway });
    if (direction === 'unsupported') {
      result.issues.push({ code: 'unsupported-direction', wayId: way.id });
      continue;
    }
    const validNodes = new Map<number, readonly [number, number]>();
    const checked = new Set<number>();
    for (const nodeId of way.nds) {
      if (checked.has(nodeId)) continue;
      checked.add(nodeId);
      const point = sourceNodes.get(nodeId);
      if (point === undefined) {
        result.issues.push({ code: 'missing-node', wayId: way.id, nodeId });
      } else if (
        !Number.isSafeInteger(nodeId) ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        Math.abs(point[0]) > 90 ||
        Math.abs(point[1]) > 180
      ) {
        result.issues.push({ code: 'invalid-node', wayId: way.id, nodeId });
      } else {
        validNodes.set(nodeId, point);
      }
    }
    for (let i = 0; i + 1 < way.nds.length; i++) {
      const from = way.nds[i]!;
      const to = way.nds[i + 1]!;
      const a = validNodes.get(from);
      const b = validNodes.get(to);
      if (a === undefined || b === undefined) continue;
      if (from === to) {
        result.issues.push({ code: 'degenerate-segment', wayId: way.id, segmentIndex: i });
        continue;
      }
      result.nodes.set(from, [a[0], a[1]]);
      result.nodes.set(to, [b[0], b[1]]);
      if (direction !== 'reverse') {
        result.edges.push({ id: result.edges.length, from, to, wayId: way.id });
      }
      if (direction !== 'forward') {
        result.edges.push({ id: result.edges.length, from: to, to: from, wayId: way.id });
      }
    }
  }
  return result;
}

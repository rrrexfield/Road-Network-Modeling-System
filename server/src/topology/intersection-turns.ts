import type { IntersectionTurns, RoadEdge } from '@gisalgo/shared';
import { computeTurnGeometry } from './turn-geometry.js';
import { TurnRestrictionTable } from './turn-restriction-table.js';

/** 单个图版本的转向索引。输入节点表在索引存续期间不得修改。 */
export class IntersectionTurnIndex {
  readonly restrictions: TurnRestrictionTable;
  private readonly incoming = new Map<number, RoadEdge[]>();
  private readonly outgoing = new Map<number, RoadEdge[]>();

  /** O(E) 建立索引；后续路口枚举只遍历该路口的入出边。 */
  constructor(
    private readonly nodes: ReadonlyMap<number, readonly [number, number]>,
    edges: readonly RoadEdge[],
  ) {
    this.restrictions = new TurnRestrictionTable(edges);
    for (const edge of edges) {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
        throw new Error(`转向索引缺失边端点: ${edge.id}`);
      }
      const copy = { ...edge };
      const incoming = this.incoming.get(edge.to) ?? [];
      incoming.push(copy);
      this.incoming.set(edge.to, incoming);
      const outgoing = this.outgoing.get(edge.from) ?? [];
      outgoing.push(copy);
      this.outgoing.set(edge.from, outgoing);
    }
  }

  /**
   * 枚举全部入边×出边（含掉头），返回冻结的 IntersectionTurns 形状。
   * @param nodeId 当前图中的节点 ID。
   * @returns 路口 [lon,lat] 位置、全部转向动作及最新禁转状态。
   * @remarks O(入度×出度)。fromOsm由禁转表的来源标记产生。
   * 对不存在节点或无法计算方向的几何抛出带定位信息的错误，不伪造角度或遗漏动作。
   */
  getTurns(nodeId: number): IntersectionTurns {
    const via = this.nodes.get(nodeId);
    if (
      via === undefined ||
      !Number.isFinite(via[0]) ||
      !Number.isFinite(via[1]) ||
      Math.abs(via[0]) > 90 ||
      Math.abs(via[1]) > 180
    ) {
      throw new Error(`路口不存在或坐标非法: ${nodeId}`);
    }
    const turns: IntersectionTurns['turns'] = [];
    for (const from of this.incoming.get(nodeId) ?? []) {
      for (const to of this.outgoing.get(nodeId) ?? []) {
        const geometry = computeTurnGeometry(
          this.nodes.get(from.from)!,
          via,
          this.nodes.get(to.to)!,
        );
        if (geometry === null) {
          throw new Error(`转向几何无法判定: ${from.id} → ${to.id} @ ${nodeId}`);
        }
        turns.push({
          fromEdge: from.id,
          toEdge: to.id,
          fromWayId: from.wayId,
          toWayId: to.wayId,
          ...geometry,
          forbidden: this.restrictions.isForbidden(nodeId, from.id, to.id),
          fromOsm: this.restrictions.isFromOsm(nodeId, from.id, to.id),
        });
      }
    }
    return { nodeId, position: [via[1], via[0]], turns };
  }
}

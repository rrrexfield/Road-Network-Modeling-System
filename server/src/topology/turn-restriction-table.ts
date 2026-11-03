import type { RoadEdge, SetIntersectionTurnsRequest, TurnRestriction } from '@gisalgo/shared';

/** 单次装载图内的禁转边对表，不用作跨会话持久化格式。 */
export class TurnRestrictionTable {
  private readonly edges = new Map<number, RoadEdge>();
  private readonly forbidden = new Map<number, Map<number, Set<number>>>();
  private readonly osmPairs = new Map<number, Set<string>>();

  constructor(edges: readonly RoadEdge[]) {
    for (const edge of edges) {
      if (this.edges.has(edge.id)) throw new Error(`重复边 ID: ${edge.id}`);
      this.edges.set(edge.id, { ...edge });
    }
  }

  /** 查询禁转边对；未登记的规则默认允许。调用方须先保证边对属于当前图。 */
  isForbidden(viaNode: number, fromEdge: number, toEdge: number): boolean {
    return this.forbidden.get(viaNode)?.get(fromEdge)?.has(toEdge) ?? false;
  }

  isFromOsm(viaNode: number, fromEdge: number, toEdge: number): boolean {
    return this.osmPairs.get(viaNode)?.has(`${fromEdge}:${toEdge}`) ?? false;
  }

  /** 导出全部实际禁转边对，包含无法生成几何类型的规则；返回独立快照。 */
  snapshot(): Pick<TurnRestriction, 'viaNode' | 'fromEdge' | 'toEdge'>[] {
    const result: ReturnType<TurnRestrictionTable['snapshot']> = [];
    for (const [viaNode, incoming] of this.forbidden) {
      for (const [fromEdge, targets] of incoming) {
        for (const toEdge of targets) result.push({ viaNode, fromEdge, toEdge });
      }
    }
    return result;
  }

  validateReplacement(viaNode: number, request: SetIntersectionTurnsRequest): void {
    for (const pair of request.forbidden) {
      const from = this.edges.get(pair.fromEdge),
        to = this.edges.get(pair.toEdge);
      if (!from || !to || from.to !== viaNode || to.from !== viaNode)
        throw new Error('非法转向边对');
    }
  }

  /** 为已经装入表的规则恢复OSM来源，不新增禁转。 */
  markOsm(pairs: readonly Pick<TurnRestriction, 'viaNode' | 'fromEdge' | 'toEdge'>[]): void {
    for (const p of pairs) {
      if (!this.isForbidden(p.viaNode, p.fromEdge, p.toEdge)) continue;
      const set = this.osmPairs.get(p.viaNode) ?? new Set<string>();
      set.add(`${p.fromEdge}:${p.toEdge}`);
      this.osmPairs.set(p.viaNode, set);
    }
  }

  /**
   * 整体覆盖一个路口的禁转集合，返回去重后的边对数。
   * 先校验全部边对，再替换稀疏表；任一边不属于该路口则抛错且原集合不变。
   * 空集合清除路口规则。复杂度 O(提交边对数)，不扫描全图。
   */
  replace(
    viaNode: number,
    request: SetIntersectionTurnsRequest,
    source: 'manual' | 'osm' = 'manual',
  ): number {
    const next = new Map<number, Set<number>>();
    const nextOsm = new Set<string>();
    let count = 0;
    for (const pair of request.forbidden) {
      const incoming = this.edges.get(pair.fromEdge);
      const outgoing = this.edges.get(pair.toEdge);
      if (
        incoming === undefined ||
        outgoing === undefined ||
        incoming.to !== viaNode ||
        outgoing.from !== viaNode
      ) {
        throw new Error(`非法转向边对: ${pair.fromEdge} → ${pair.toEdge} @ ${viaNode}`);
      }
      let targets = next.get(pair.fromEdge);
      if (targets === undefined) {
        targets = new Set();
        next.set(pair.fromEdge, targets);
      }
      if (!targets.has(pair.toEdge)) {
        targets.add(pair.toEdge);
        count++;
      }
      if (source === 'osm' || this.isFromOsm(viaNode, pair.fromEdge, pair.toEdge))
        nextOsm.add(`${pair.fromEdge}:${pair.toEdge}`);
    }
    if (count === 0) this.forbidden.delete(viaNode);
    else this.forbidden.set(viaNode, next);
    if (nextOsm.size) this.osmPairs.set(viaNode, nextOsm);
    else this.osmPairs.delete(viaNode);
    return count;
  }
}

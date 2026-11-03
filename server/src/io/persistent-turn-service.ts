import type {
  SetIntersectionTurnsRequest,
  SetIntersectionTurnsResponse,
  TravelMode,
} from '@gisalgo/shared';
import {
  IntersectionTurnIndex,
  importOsmRestrictions,
  type TopologyResult,
} from '../topology/index.js';
import type { OsmRelation } from './osm-relations.js';
import { TurnRestrictionStore } from './turn-restriction-store.js';

/** 供A/B直接使用的同步持久化门面：启动恢复、OSM来源和磁盘优先更新，不包含REST路由。 */
export class PersistentTurnService {
  private readonly index: IntersectionTurnIndex;
  private readonly store: TurnRestrictionStore;
  readonly importReport: ReturnType<typeof importOsmRestrictions>;
  readonly restoreIssues: ReturnType<TurnRestrictionStore['restore']>['issues'];

  constructor(
    private readonly topology: TopologyResult,
    options: {
      databasePath: string;
      dataset: string;
      mode?: TravelMode;
      relations?: readonly OsmRelation[];
    },
  ) {
    this.index = new IntersectionTurnIndex(topology.nodes, topology.edges);
    this.store = new TurnRestrictionStore(options.databasePath, options.dataset);
    this.importReport = importOsmRestrictions(
      options.relations ?? [],
      topology.edges,
      options.mode ?? 'car',
    );
    const persisted = this.store.hasSnapshot();
    const restored = persisted
      ? this.store.restore(topology)
      : { pairs: this.importReport.restrictions, issues: [] };
    this.restoreIssues = restored.issues;
    const grouped = new Map<number, SetIntersectionTurnsRequest['forbidden']>();
    for (const p of restored.pairs) {
      const group = grouped.get(p.viaNode) ?? [];
      group.push(p);
      grouped.set(p.viaNode, group);
    }
    for (const [via, forbidden] of grouped) this.index.restrictions.replace(via, { forbidden });
    this.index.restrictions.markOsm(this.importReport.restrictions);
  }

  getTurns(nodeId: number) {
    return this.index.getTurns(nodeId);
  }
  isForbidden(via: number, from: number, to: number): boolean {
    return this.index.restrictions.isForbidden(via, from, to);
  }

  /** 校验完整请求，先事务写盘，再同步内存；写盘失败时旧内存规则不变。 */
  setTurns(nodeId: number, request: SetIntersectionTurnsRequest): SetIntersectionTurnsResponse {
    if (this.restoreIssues.length) throw new Error('恢复存在失配，须先处理诊断，禁止覆盖旧快照');
    if (!this.topology.nodes.has(nodeId)) throw new Error('路口不存在');
    if (
      !request ||
      !Array.isArray(request.forbidden) ||
      request.forbidden.some(
        (p) => !p || !Number.isSafeInteger(p.fromEdge) || !Number.isSafeInteger(p.toEdge),
      )
    )
      throw new Error('非法禁转请求');
    const forbidden = request.forbidden.map((p) => ({ fromEdge: p.fromEdge, toEdge: p.toEdge }));
    this.index.restrictions.validateReplacement(nodeId, { forbidden });
    const next = this.index.restrictions.snapshot().filter((p) => p.viaNode !== nodeId);
    next.push(...forbidden.map((p) => ({ ...p, viaNode: nodeId })));
    this.store.save(this.topology, next);
    const restrictionCount = this.index.restrictions.replace(nodeId, { forbidden });
    return { ok: true, restrictionCount };
  }
}

import { DatabaseSync } from 'node:sqlite';
import type { RoadEdge, TurnRestriction } from '@gisalgo/shared';

type Pair = Pick<TurnRestriction, 'viaNode' | 'fromEdge' | 'toEdge'>;
interface Network {
  nodes: ReadonlyMap<number, readonly [number, number]>;
  edges: readonly RoadEdge[];
}
interface StoredTurn {
  viaNode: number;
  from: { wayId: number; from: number; to: number };
  to: { wayId: number; from: number; to: number };
  positions: number[][];
}

const key = (edge: StoredTurn['from']): string => `${edge.wayId}:${edge.from}:${edge.to}`;
const stableEdge = (edge: RoadEdge): StoredTurn['from'] => ({
  wayId: edge.wayId,
  from: edge.from,
  to: edge.to,
});

/** 独立 SQLite 文件中的手动禁转快照；dataset 标识数据集，禁止存当前 edgeId。 */
export class TurnRestrictionStore {
  constructor(
    private readonly file: string,
    private readonly dataset: string,
  ) {
    if (!dataset.trim()) throw new Error('数据集标识不能为空');
  }

  private open(): DatabaseSync {
    const db = new DatabaseSync(this.file);
    try {
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1) throw new Error(`不支持的禁转存储版本: ${version}`);
      db.exec(
        'CREATE TABLE IF NOT EXISTS turn_snapshots (dataset TEXT NOT NULL, ordinal INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(dataset, ordinal))',
      );
      if (version === 0) db.exec('PRAGMA user_version = 1');
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /**
   * 校验完整集合后，以事务整体替换该数据集快照；空数组表示清空。
   * 保存 wayId、有向段端点和三处原始坐标，既不丢失 ambiguous 禁转，也不保存易变 edgeId。
   */
  save(network: Network, pairs: readonly Pair[]): void {
    const edges = new Map<number, RoadEdge>();
    for (const edge of network.edges) {
      if (edges.has(edge.id)) throw new Error(`重复边 ID: ${edge.id}`);
      edges.set(edge.id, edge);
    }
    const seen = new Set<string>();
    const records: StoredTurn[] = [];
    for (const pair of pairs) {
      const from = edges.get(pair.fromEdge);
      const to = edges.get(pair.toEdge);
      if (!from || !to || from.to !== pair.viaNode || to.from !== pair.viaNode) {
        throw new Error('无法保存：非法转向边对');
      }
      const positions = [from.from, pair.viaNode, to.to].map((id) => {
        const p = network.nodes.get(id);
        if (
          !p ||
          !Number.isFinite(p[0]) ||
          !Number.isFinite(p[1]) ||
          Math.abs(p[0]) > 90 ||
          Math.abs(p[1]) > 180
        )
          throw new Error('无法保存：非法坐标');
        return [p[0], p[1]];
      });
      const record = {
        viaNode: pair.viaNode,
        from: stableEdge(from),
        to: stableEdge(to),
        positions,
      };
      this.validate(record);
      const identity = `${key(record.from)}>${key(record.to)}`;
      if (!seen.has(identity)) {
        records.push(record);
        seen.add(identity);
      }
    }
    const db = this.open();
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM turn_snapshots WHERE dataset = ?').run(this.dataset);
        const insert = db.prepare('INSERT INTO turn_snapshots VALUES (?, ?, ?)');
        records.forEach((record, i) => insert.run(this.dataset, i, JSON.stringify(record)));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db.close();
    }
  }

  /**
   * 重新匹配当前有向段，返回边对及失配明细；不自动修改运行中的禁转表。
   * 坐标严格比较，不做模糊吸附；数据更新导致的歧义必须人工处理。
   * 复杂度 O(当前边数 + 存储规则数)。ordinal 是文件内记录序号，不是 edgeId。
   */
  restore(network: Network): {
    pairs: Pair[];
    issues: {
      ordinal: number;
      reason: 'missing-segment' | 'ambiguous-segment' | 'geometry-changed';
    }[];
  } {
    const index = new Map<string, RoadEdge[]>();
    const edgeIds = new Set<number>();
    for (const edge of network.edges) {
      if (edgeIds.has(edge.id)) throw new Error(`重复边 ID: ${edge.id}`);
      edgeIds.add(edge.id);
      const id = key(edge);
      const list = index.get(id) ?? [];
      list.push(edge);
      index.set(id, list);
    }
    const db = this.open();
    const pairs: Pair[] = [];
    const issues: ReturnType<TurnRestrictionStore['restore']>['issues'] = [];
    try {
      const rows = db
        .prepare('SELECT ordinal, payload FROM turn_snapshots WHERE dataset = ? ORDER BY ordinal')
        .all(this.dataset);
      for (const row of rows) {
        const record: unknown = JSON.parse(String(row.payload));
        this.validate(record);
        const from = index.get(key(record.from)) ?? [];
        const to = index.get(key(record.to)) ?? [];
        const ordinal = Number(row.ordinal);
        if (!from.length || !to.length) {
          issues.push({ ordinal, reason: 'missing-segment' });
          continue;
        }
        if (from.length !== 1 || to.length !== 1) {
          issues.push({ ordinal, reason: 'ambiguous-segment' });
          continue;
        }
        const positions = [record.from.from, record.viaNode, record.to.to].map((id) =>
          network.nodes.get(id),
        );
        if (
          positions.some(
            (p, i) => !p || p[0] !== record.positions[i]![0] || p[1] !== record.positions[i]![1],
          )
        ) {
          issues.push({ ordinal, reason: 'geometry-changed' });
          continue;
        }
        pairs.push({ viaNode: record.viaNode, fromEdge: from[0]!.id, toEdge: to[0]!.id });
      }
      return { pairs, issues };
    } finally {
      db.close();
    }
  }

  private validate(value: unknown): asserts value is StoredTurn {
    if (!value || typeof value !== 'object') throw new Error('非法禁转快照');
    const r = value as StoredTurn;
    const edgeValid = (e: StoredTurn['from']): boolean =>
      !!e && [e.wayId, e.from, e.to].every(Number.isSafeInteger);
    if (
      !Number.isSafeInteger(r.viaNode) ||
      !edgeValid(r.from) ||
      !edgeValid(r.to) ||
      r.from.to !== r.viaNode ||
      r.to.from !== r.viaNode ||
      !Array.isArray(r.positions) ||
      r.positions.length !== 3 ||
      !r.positions.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every(Number.isFinite) &&
          Math.abs(p[0]!) <= 90 &&
          Math.abs(p[1]!) <= 180,
      )
    ) {
      throw new Error('非法禁转快照');
    }
  }
}

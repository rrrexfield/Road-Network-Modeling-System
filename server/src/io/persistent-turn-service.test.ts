import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { PersistentTurnService, type OsmRelation } from './index';
import { buildTopology } from '../topology/index';

const dirs: string[] = [];
const file = () => {
  const d = mkdtempSync(join(tmpdir(), 'gisalgo-service-'));
  dirs.push(d);
  return join(d, 'turns.sqlite');
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    if (!resolve(d).startsWith(resolve(tmpdir()) + sep)) throw Error('路径越界');
    rmSync(d, { recursive: true });
  }
});
const nodes = new Map<number, [number, number]>([
  [1, [30, 114]],
  [2, [30, 114.1]],
  [3, [30.1, 114.1]],
  [4, [29.9, 114.1]],
]);
const ways = [
  { id: 100, highway: 'residential', tags: { oneway: 'yes' }, nds: [1, 2] },
  { id: 200, highway: 'residential', tags: { oneway: 'yes' }, nds: [2, 3] },
  { id: 300, highway: 'residential', tags: { oneway: 'yes' }, nds: [2, 4] },
];
const relation: OsmRelation = {
  id: 9,
  tags: [
    { k: 'type', v: 'restriction' },
    { k: 'restriction', v: 'no_left_turn' },
  ],
  members: [
    { type: 'way', ref: 100, role: 'from' },
    { type: 'node', ref: 2, role: 'via' },
    { type: 'way', ref: 200, role: 'to' },
  ],
};

describe('PersistentTurnService 可交接运行链路', () => {
  it('压缩状态包含OSM和人工禁转，保存后递增、清空后移除，重启恢复节点', () => {
    const opts = { databasePath: file(), dataset: 'compression', relations: [relation] };
    const topology = buildTopology(nodes, ways);
    const service = new PersistentTurnService(topology, opts);
    expect(service.getCompressionState()).toEqual({ version: 0, protectedNodeIds: [2] });
    service.getCompressionState().protectedNodeIds.length = 0;
    expect(service.getCompressionState().protectedNodeIds).toEqual([2]);
    service.setTurns(2, { forbidden: [{ fromEdge: 0, toEdge: 2 }] });
    expect(service.getCompressionState()).toEqual({ version: 1, protectedNodeIds: [2] });
    expect(new PersistentTurnService(topology, opts).getCompressionState()).toEqual({
      version: 0,
      protectedNodeIds: [2],
    });
    service.setTurns(2, { forbidden: [] });
    expect(service.getCompressionState()).toEqual({ version: 2, protectedNodeIds: [] });
  });
  it('OSM来源正确，手动更新保存后重启与边ID重排恢复', () => {
    const path = file();
    const topo = buildTopology(nodes, ways);
    const service = new PersistentTurnService(topo, {
      databasePath: path,
      dataset: 'test:car',
      relations: [relation],
    });
    expect(service.getTurns(2).turns.find((t) => t.toEdge === 1)).toMatchObject({
      forbidden: true,
      fromOsm: true,
    });
    expect(
      service.setTurns(2, {
        forbidden: [
          { fromEdge: 0, toEdge: 1 },
          { fromEdge: 0, toEdge: 2 },
        ],
      }).restrictionCount,
    ).toBe(2);
    const reordered = buildTopology(nodes, [ways[2]!, ways[0]!, ways[1]!]);
    const restarted = new PersistentTurnService(reordered, {
      databasePath: path,
      dataset: 'test:car',
      relations: [relation],
    });
    expect(restarted.isForbidden(2, 1, 2)).toBe(true);
    expect(restarted.isForbidden(2, 1, 0)).toBe(true);
    expect(restarted.getTurns(2).turns.find((t) => t.toEdge === 2)?.fromOsm).toBe(true);
    expect(restarted.getTurns(2).turns.find((t) => t.toEdge === 0)?.fromOsm).toBe(false);
  });
  it('清空后重启不会重新启用OSM规则', () => {
    const path = file();
    const topo = buildTopology(nodes, ways);
    const opts = { databasePath: path, dataset: 'test', relations: [relation] };
    const service = new PersistentTurnService(topo, opts);
    service.setTurns(2, { forbidden: [] });
    expect(new PersistentTurnService(topo, opts).getTurns(2).turns.every((t) => !t.forbidden)).toBe(
      true,
    );
  });
  it('写盘失败不改变内存与旧快照', () => {
    const path = file();
    const topo = buildTopology(nodes, ways);
    const opts = { databasePath: path, dataset: 'test' };
    const service = new PersistentTurnService(topo, opts);
    service.setTurns(2, { forbidden: [{ fromEdge: 0, toEdge: 1 }] });
    const lock = new DatabaseSync(path);
    lock.exec('BEGIN EXCLUSIVE');
    try {
      expect(() => service.setTurns(2, { forbidden: [] })).toThrow();
      expect(service.isForbidden(2, 0, 1)).toBe(true);
      expect(service.getCompressionState()).toEqual({ version: 1, protectedNodeIds: [2] });
    } finally {
      lock.exec('ROLLBACK');
      lock.close();
    }
    expect(new PersistentTurnService(topo, opts).isForbidden(2, 0, 1)).toBe(true);
  });
  it('非法请求不影响原规则；恢复失配时禁止默默覆盖旧记录', () => {
    const path = file();
    const topo = buildTopology(nodes, ways);
    const opts = { databasePath: path, dataset: 'test' };
    const service = new PersistentTurnService(topo, opts);
    service.setTurns(2, { forbidden: [{ fromEdge: 0, toEdge: 1 }] });
    expect(() => service.setTurns(2, { forbidden: [{ fromEdge: 0, toEdge: 99 }] })).toThrow();
    expect(service.getCompressionState().version).toBe(1);
    expect(service.isForbidden(2, 0, 1)).toBe(true);
    const changed = buildTopology(nodes, [ways[0]!, ways[2]!]);
    const restarted = new PersistentTurnService(changed, opts);
    expect(restarted.restoreIssues).toHaveLength(1);
    expect(() => restarted.setTurns(2, { forbidden: [] })).toThrow('失配');
  });
});

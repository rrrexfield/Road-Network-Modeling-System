import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnRestrictionStore } from './index';
import { TurnRestrictionTable } from '../topology/index';

const directories: string[] = [];
function file() {
  const directory = mkdtempSync(join(tmpdir(), 'gisalgo-turn-test-'));
  directories.push(directory);
  return join(directory, 'restrictions.sqlite');
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
      throw new Error('测试清理路径越界');
    rmSync(directory, { recursive: true });
  }
});
function network(offset = 0) {
  return {
    nodes: new Map<number, [number, number]>([
      [1, [30, 114]],
      [2, [30, 114.1]],
      [3, [30.1, 114.1]],
    ]),
    edges: [
      { id: 10 + offset, from: 1, to: 2, wayId: 100 },
      { id: 20 + offset, from: 2, to: 3, wayId: 200 },
    ],
  };
}
const pair = { viaNode: 2, fromEdge: 10, toEdge: 20 };

describe('TurnRestrictionStore', () => {
  it('新建实例模拟重启，edge ID 重排后恢复实际边对并可装入禁转表', () => {
    const path = file();
    new TurnRestrictionStore(path, 'wuhan').save(network(), [pair]);
    const current = network(1000);
    const restored = new TurnRestrictionStore(path, 'wuhan').restore(current);
    expect(restored).toEqual({ pairs: [{ viaNode: 2, fromEdge: 1010, toEdge: 1020 }], issues: [] });
    const table = new TurnRestrictionTable(current.edges);
    for (const p of restored.pairs) table.replace(p.viaNode, { forbidden: [p] });
    expect(table.isForbidden(2, 1010, 1020)).toBe(true);
    expect(table.snapshot()).toEqual(restored.pairs);
    const db = new DatabaseSync(path);
    try {
      const payload = String(db.prepare('SELECT payload FROM turn_snapshots').get()!.payload);
      expect(payload).not.toContain('fromEdge');
      expect(payload).not.toContain('toEdge');
    } finally {
      db.close();
    }
  });

  it('非法保存不破坏旧快照，空集合可清空且数据集相互隔离', () => {
    const path = file();
    const a = new TurnRestrictionStore(path, 'a');
    const b = new TurnRestrictionStore(path, 'b');
    a.save(network(), [pair, pair]);
    b.save(network(), [pair]);
    expect(() => a.save(network(), [pair, { ...pair, toEdge: 99 }])).toThrow('非法');
    expect(a.restore(network()).pairs).toEqual([pair]);
    a.save(network(), []);
    expect(a.restore(network()).pairs).toEqual([]);
    expect(b.restore(network()).pairs).toEqual([pair]);
  });

  it('源道路段缺失时报告，不把旧边ID套到其他道路', () => {
    const store = new TurnRestrictionStore(file(), 'wuhan');
    store.save(network(), [pair]);
    const changed = network();
    changed.edges[1]!.wayId = 999;
    expect(store.restore(changed)).toEqual({
      pairs: [],
      issues: [{ ordinal: 0, reason: 'missing-segment' }],
    });
  });

  it('多个同标识有向段不任意挑选第一条', () => {
    const store = new TurnRestrictionStore(file(), 'wuhan');
    store.save(network(), [pair]);
    const changed = network();
    changed.edges.push({ ...changed.edges[0]!, id: 30 });
    expect(store.restore(changed)).toEqual({
      pairs: [],
      issues: [{ ordinal: 0, reason: 'ambiguous-segment' }],
    });
  });

  it('几何变化时报告，不在更新后的路口上默默恢复旧规则', () => {
    const store = new TurnRestrictionStore(file(), 'wuhan');
    store.save(network(), [pair]);
    const changed = network();
    changed.nodes.set(2, [30.2, 114.1]);
    expect(store.restore(changed)).toEqual({
      pairs: [],
      issues: [{ ordinal: 0, reason: 'geometry-changed' }],
    });
  });

  it('损坏快照报错，不产生部分恢复结果', () => {
    const path = file();
    const store = new TurnRestrictionStore(path, 'wuhan');
    store.save(network(), [pair]);
    const db = new DatabaseSync(path);
    try {
      db.prepare('UPDATE turn_snapshots SET payload = ?').run('{"viaNode":2}');
    } finally {
      db.close();
    }
    expect(() => store.restore(network())).toThrow('非法禁转快照');
  });

  it('拒绝未知格式版本和空数据集标识', () => {
    const path = file();
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version=2');
    db.close();
    expect(() => new TurnRestrictionStore(path, 'wuhan').restore(network())).toThrow('版本');
    expect(() => new TurnRestrictionStore(path, '')).toThrow('标识');
  });
});

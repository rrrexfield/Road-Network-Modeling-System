import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepare } from '../../../scripts/prepare-data';
import { createTurnRuntime } from './index';

describe('完整派生文件到SQLite运行时', () => {
  it('节点过滤接入运行时；SQLite部分失配时禁止覆盖且原快照仍可恢复', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gisalgo-node-access-'));
    try {
      const raw = {
        nodes: [
          { id: 1, lat: 30, lon: 114, tags: [] as { k: string; v: string }[] },
          { id: 2, lat: 30, lon: 114.001, tags: [] as { k: string; v: string }[] },
          { id: 3, lat: 30.001, lon: 114.001, tags: [] as { k: string; v: string }[] },
          { id: 4, lat: 29.999, lon: 114.001, tags: [] as { k: string; v: string }[] },
        ],
        ways: [
          { id: 10, nds: [1, 2], tags: [{ k: 'highway', v: 'residential' }] },
          { id: 20, nds: [2, 3], tags: [{ k: 'highway', v: 'residential' }] },
          { id: 30, nds: [2, 4], tags: [{ k: 'highway', v: 'residential' }] },
        ],
        relations: [],
      };
      const file = join(dir, 'derived.json');
      const opts = {
        databasePath: join(dir, 'turns.sqlite'),
        dataset: 'node-access-test',
        mode: 'walk' as const,
      };
      writeFileSync(file, JSON.stringify(prepare(raw)));
      const original = createTurnRuntime(pathToFileURL(file), opts);
      const pairs = original.service
        .getTurns(2)
        .turns.filter((t) => t.fromWayId === 10 && (t.toWayId === 20 || t.toWayId === 30));
      expect(pairs).toHaveLength(2);
      original.service.setTurns(2, { forbidden: pairs });
      raw.nodes[2]!.tags = [{ k: 'foot', v: 'permit' }];
      writeFileSync(file, JSON.stringify(prepare(raw)));
      const filtered = createTurnRuntime(pathToFileURL(file), opts);
      expect(filtered.modal.nodeAccess.checked).toBe(true);
      expect(filtered.modal.topology.nodes.has(3)).toBe(false);
      expect(filtered.service.restoreIssues).toHaveLength(1);
      const remaining = filtered.service
        .getTurns(2)
        .turns.find((t) => t.fromWayId === 10 && t.toWayId === 30)!;
      expect(remaining.forbidden).toBe(true);
      expect(() => filtered.service.setTurns(2, { forbidden: [] })).toThrow('恢复存在失配');
      raw.nodes[2]!.tags = [];
      writeFileSync(file, JSON.stringify(prepare(raw)));
      const recovered = createTurnRuntime(pathToFileURL(file), opts);
      expect(recovered.service.restoreIssues).toEqual([]);
      expect(recovered.service.getTurns(2).turns.filter((t) => t.forbidden)).toHaveLength(2);
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error('越界');
      rmSync(dir, { recursive: true });
    }
  });
  it('预处理→读文件→OSM导入→手动保存→新建运行时恢复', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gisalgo-runtime-'));
    try {
      const raw = {
        nodes: [
          { id: 1, lat: 30, lon: 114, tags: [] },
          { id: 2, lat: 30, lon: 114.1, tags: [] },
          { id: 3, lat: 30.1, lon: 114.1, tags: [] },
        ],
        ways: [
          { id: 10, nds: [1, 2], tags: [{ k: 'highway', v: 'residential' }] },
          { id: 20, nds: [2, 3], tags: [{ k: 'highway', v: 'residential' }] },
        ],
        relations: [],
      };
      const file = join(dir, 'derived.json');
      writeFileSync(file, JSON.stringify(prepare(raw)));
      const opts = {
        databasePath: join(dir, 'turns.sqlite'),
        dataset: 'test',
        mode: 'car' as const,
      };
      const runtime = createTurnRuntime(pathToFileURL(file), opts);
      const pair = runtime.service.getTurns(2).turns[0]!;
      runtime.service.setTurns(2, { forbidden: [pair] });
      expect(
        createTurnRuntime(pathToFileURL(file), opts).service.isForbidden(
          2,
          pair.fromEdge,
          pair.toEdge,
        ),
      ).toBe(true);
      const old = prepare(raw);
      delete (old as Partial<typeof old>).relations;
      writeFileSync(file, JSON.stringify(old));
      expect(() => createTurnRuntime(pathToFileURL(file), opts)).toThrow('重新运行');
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error('越界');
      rmSync(dir, { recursive: true });
    }
  });
});

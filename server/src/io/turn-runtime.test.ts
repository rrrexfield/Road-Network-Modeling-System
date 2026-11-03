import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepare } from '../../../scripts/prepare-data';
import { createTurnRuntime } from './index';

describe('完整派生文件到SQLite运行时', () => {
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

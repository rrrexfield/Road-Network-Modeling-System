import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepare } from '../../../scripts/prepare-data.js';

describe('标签覆盖审计命令', () => {
  it('区分缺失设施标签、道路已保留标签和旧派生缺点，不改输入文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gisalgo-tag-audit-'));
    try {
      const raw = {
        nodes: [
          {
            id: 1,
            lat: 30,
            lon: 114,
            tags: [
              { k: 'amenity', v: 'parking' },
              { k: 'foot', v: 'permit' },
            ],
          },
          { id: 2, lat: 30, lon: 114.001, tags: [] },
          {
            id: 3,
            lat: 30,
            lon: 114.002,
            tags: [
              { k: 'amenity', v: 'parking' },
              { k: 'motorcar', v: 'permit' },
            ],
          },
          {
            id: 4,
            lat: 30,
            lon: 114.003,
            tags: [
              { k: 'highway', v: 'bus_stop' },
              { k: 'bus', v: 'yes' },
            ],
          },
        ],
        ways: [
          { id: 10, nds: [1, 2], tags: [{ k: 'highway', v: 'residential' }] },
          { id: 20, nds: [1, 2, 3], tags: [{ k: 'amenity', v: 'parking' }] },
        ],
        relations: [],
      };
      const rawPath = join(dir, 'raw.json'),
        derivedPath = join(dir, 'derived.json'),
        out = join(dir, 'audit.json');
      const prepared = prepare(raw);
      prepared.transferPoints.points = prepared.transferPoints.points.filter((p) => p.id !== 6);
      writeFileSync(rawPath, JSON.stringify(raw));
      writeFileSync(derivedPath, JSON.stringify(prepared));
      const rawBefore = readFileSync(rawPath),
        derivedBefore = readFileSync(derivedPath);
      const script = fileURLToPath(new URL('./audit-transfer-tags.ts', import.meta.url));
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', script, rawPath, derivedPath, out],
        { encoding: 'utf8' },
      );
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(readFileSync(out, 'utf8'));
      expect(report.summary).toMatchObject({
        rawPoints: 4,
        derivedPoints: 3,
        nodeSources: 3,
        waySources: 1,
        nodeSourcesWithRetainedTags: 1,
        nodeSourcesWithoutRetainedTags: 2,
        taggedNodeSourcesMissingFromRoadMap: 2,
        missingNodesWithExplicitRestrictions: 1,
        retainedTagMismatches: 0,
        missingFromDerived: [6],
      });
      expect(readFileSync(rawPath)).toEqual(rawBefore);
      expect(readFileSync(derivedPath)).toEqual(derivedBefore);
      const overwrite = spawnSync(
        process.execPath,
        ['--import', 'tsx', script, rawPath, derivedPath, rawPath],
        { encoding: 'utf8' },
      );
      expect(overwrite.status).not.toBe(0);
      expect(overwrite.stderr).toContain('不能覆盖输入');
      expect(readFileSync(rawPath)).toEqual(rawBefore);
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error('审计测试清理越界');
      rmSync(dir, { recursive: true });
    }
  });
});

/** 武汉固定快照C侧回归：始终在新目录生成派生文件与SQLite，不改用户数据/禁转库。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepare, type RawOsmJson } from '../../../scripts/prepare-data.js';
import { buildModalTopology } from '../topology/index.js';
import { createTurnRuntime, loadNetwork } from './index.js';

const [rawPath, parentPath] = process.argv.slice(2);
if (!rawPath || !parentPath)
  throw new Error(
    '用法：node --max-old-space-size=6144 --import tsx server/src/io/check-sprint2-data.ts 武汉原始.json 已存在的输出父目录',
  );
const bytes = readFileSync(rawPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(
  sha256,
  '0d23735b19f5d7f311b7f2c5f243620860970fbb86f9e4853d52b6a904214a3d',
  '源快照变化，需人工复核后更新固定预期',
);
const raw = JSON.parse(bytes.toString()) as RawOsmJson;
const dir = mkdtempSync(join(resolve(parentPath), 'c-sprint2-check-'));
const prepared = prepare(raw);
assert.equal(prepared.nodeTags.length, 6995);
assert.equal(prepared.relations.length, 353);
assert.equal(prepared.transferPoints.points.length, 2930);
const kinds = Object.fromEntries(
  ['bus', 'subway', 'parking'].map((k) => [
    k,
    prepared.transferPoints.points.filter((p) => p.kind === k).length,
  ]),
);
assert.deepEqual(kinds, { bus: 1231, subway: 659, parking: 1040 });
const file = join(dir, 'derived.json');
writeFileSync(file, JSON.stringify(prepared), { flag: 'wx' });
const network = loadNetwork(pathToFileURL(file));
assert.deepEqual(network.dataWarnings, []);
const expected = { car: 986418, walk: 1214979, bike: 995720, bus: 987037 };
const modes = [];
for (const mode of ['car', 'walk', 'bike', 'bus'] as const) {
  const m = buildModalTopology(network.nodes, network.ways, mode, network.nodeTags);
  assert(m.nodeAccess.checked);
  assert.equal(m.topology.edges.length, expected[mode]);
  assert(m.nodeAccess.excludedNodes.some((n) => n.nodeId === 1358787382));
  assert(!m.topology.nodes.has(1358787382));
  modes.push({
    mode,
    nodes: m.topology.nodes.size,
    edges: m.topology.edges.length,
    excludedNodes: m.nodeAccess.excludedNodes.length,
    excludedEdges: m.nodeAccess.excludedEdgeCount,
  });
}
const options = {
  databasePath: join(dir, 'turns.sqlite'),
  dataset: 'c-sprint2-check',
  mode: 'car' as const,
};
const first = createTurnRuntime(pathToFileURL(file), options);
assert.equal(first.service.restoreIssues.length, 0);
const via = 1881981626;
const turns = first.service.getTurns(via).turns;
assert.equal(turns.length, 12);
const chosen = turns.find((t) => !t.forbidden);
assert(chosen, '没有可用动作可验证持久化');
first.service.setTurns(via, { forbidden: [...turns.filter((t) => t.forbidden), chosen] });
const second = createTurnRuntime(pathToFileURL(file), options);
assert.equal(second.service.restoreIssues.length, 0);
assert(second.service.isForbidden(via, chosen.fromEdge, chosen.toEdge));
const restored = second.service
  .getTurns(via)
  .turns.find((t) => t.fromEdge === chosen.fromEdge && t.toEdge === chosen.toEdge);
assert(restored?.forbidden);
const report = {
  scope: 'C模块固定数据回归，不是网页或实景通行验收',
  sourceSha256: sha256,
  outputDir: dir,
  derivedFile: file,
  nodeTags: prepared.nodeTags.length,
  relations: prepared.relations.length,
  transferPoints: prepared.transferPoints.points.length,
  kinds,
  modes,
  fiveArmTurns: turns.length,
  sqlite: { restored: true, restoreIssues: second.service.restoreIssues.length },
  unvalidated: ['网页运行时接线与几何一致性', '设施自身完整标签接入', '近似换乘实景许可'],
};
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));

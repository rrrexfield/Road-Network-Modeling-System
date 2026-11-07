/** 只读原始/派生数据，审计设施源标签覆盖。显式指定新输出文件，不改数据格式或准入策略。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractTransferPoints, loadNetwork } from './index.js';

const [rawPath, derivedPath, outputPath] = process.argv.slice(2);
if (!rawPath || !derivedPath || !outputPath)
  throw new Error(
    '用法：node --max-old-space-size=6144 --import tsx server/src/io/audit-transfer-tags.ts 原始.json 派生.json 新报告.json',
  );
if ([resolve(rawPath), resolve(derivedPath)].includes(resolve(outputPath)))
  throw new Error('报告路径不能覆盖输入文件');
const bytes = readFileSync(rawPath);
const raw = JSON.parse(bytes.toString()) as Parameters<typeof extractTransferPoints>[0];
const data = extractTransferPoints(raw);
const derived = loadNetwork(pathToFileURL(resolve(derivedPath)));
const nodeIds = new Set(data.sources.filter((s) => s.sourceType === 'node').map((s) => s.sourceId));
const wayIds = new Set(data.sources.filter((s) => s.sourceType === 'way').map((s) => s.sourceId));
const rawNodes = new Map(raw.nodes.filter((n) => nodeIds.has(n.id)).map((n) => [n.id, n]));
const rawWays = new Map(raw.ways.filter((w) => wayIds.has(w.id)).map((w) => [w.id, w]));
const canonical = (tags: readonly { k: string; v: string }[]) =>
  JSON.stringify(
    tags.map((t) => [t.k, t.v]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
const relevant = (k: string) =>
  /^(access|foot|bicycle|vehicle|motor_vehicle|motorcar|bus|psv|barrier|level|layer)(:|$)/.test(k);
const rows = data.sources.map((source) => {
  const element =
    source.sourceType === 'node' ? rawNodes.get(source.sourceId) : rawWays.get(source.sourceId);
  assert(element, `源元素缺失:${source.sourceType}/${source.sourceId}`);
  const retained = source.sourceType === 'node' ? derived.nodeTags.get(source.sourceId) : undefined;
  const relevantTags = Object.fromEntries(
    element.tags.filter((t) => relevant(t.k)).map((t) => [t.k, t.v]),
  );
  return {
    pointId: source.pointId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    modes: source.modes,
    rawTagCount: element.tags.length,
    relevantTags,
    retainedRoadEntry: source.sourceType === 'node' ? retained !== undefined : null,
    retainedMatchesRaw:
      retained === undefined ? null : canonical(retained) === canonical(element.tags),
  };
});
const nodeRows = rows.filter((r) => r.sourceType === 'node');
const wayRows = rows.filter((r) => r.sourceType === 'way');
const countKinds = (points: typeof data.points) =>
  Object.fromEntries(
    ['bus', 'subway', 'parking'].map((kind) => [
      kind,
      points.filter((p) => p.kind === kind).length,
    ]),
  );
const rawPointIds = new Set(data.points.map((p) => p.id));
const derivedPointIds = new Set(derived.transferPoints.points.map((p) => p.id));
const summary = {
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  rawPoints: data.points.length,
  rawKinds: countKinds(data.points),
  derivedPoints: derived.transferPoints.points.length,
  derivedKinds: countKinds(derived.transferPoints.points),
  missingFromDerived: [...rawPointIds].filter((id) => !derivedPointIds.has(id)),
  extraInDerived: [...derivedPointIds].filter((id) => !rawPointIds.has(id)),
  nodeSources: nodeRows.length,
  waySources: wayRows.length,
  retainedRoadTagEntries: derived.nodeTags.size,
  nodeSourcesWithRetainedTags: nodeRows.filter((r) => r.retainedRoadEntry).length,
  nodeSourcesWithoutRetainedTags: nodeRows.filter((r) => !r.retainedRoadEntry).length,
  taggedNodeSourcesMissingFromRoadMap: nodeRows.filter(
    (r) => !r.retainedRoadEntry && r.rawTagCount > 0,
  ).length,
  retainedTagMismatches: nodeRows.filter((r) => r.retainedMatchesRaw === false).length,
  nodesWithRelevantTags: nodeRows.filter((r) => Object.keys(r.relevantTags).length).length,
  relevantNodesMissingFromRoadMap: nodeRows.filter(
    (r) => !r.retainedRoadEntry && Object.keys(r.relevantTags).length,
  ).length,
  waySourcesWithRelevantTags: wayRows.filter((r) => Object.keys(r.relevantTags).length).length,
  missingNodesWithExplicitRestrictions: nodeRows.filter(
    (r) =>
      !r.retainedRoadEntry &&
      Object.entries(r.relevantTags).some(
        ([k, v]) =>
          /^(access|foot|bicycle|vehicle|motor_vehicle|motorcar|bus|psv)(:|$)/.test(k) &&
          ['no', 'private', 'permit'].includes(v),
      ),
  ).length,
  missingNodesWithBarrier: nodeRows.filter(
    (r) => !r.retainedRoadEntry && r.relevantTags.barrier !== undefined,
  ).length,
  missingNodesWithConditional: nodeRows.filter(
    (r) =>
      !r.retainedRoadEntry && Object.keys(r.relevantTags).some((k) => k.endsWith(':conditional')),
  ).length,
  missingNodesWithLevelOrLayer: nodeRows.filter(
    (r) =>
      !r.retainedRoadEntry &&
      (r.relevantTags.level !== undefined || r.relevantTags.layer !== undefined),
  ).length,
  extractionIssues: data.issues.length,
};
assert.equal(summary.nodeSources + summary.waySources, summary.rawPoints);
assert.equal(rawPointIds.size, summary.rawPoints);
writeFileSync(outputPath, JSON.stringify({ summary, rows }, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify(
    {
      ...summary,
      missingFromDerived: summary.missingFromDerived.length,
      extraInDerived: summary.extraInDerived.length,
    },
    null,
    2,
  ),
);

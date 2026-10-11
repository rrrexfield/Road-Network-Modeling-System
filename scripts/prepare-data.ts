/**
 * 一次性数据预处理:解析 data/wuhan.json(教师备份 OSM JSON),
 * 过滤出 highway 路网及其关联节点,写出紧凑派生文件 data/derived/wuhan-roads.json。
 *
 * 运行:npm run prepare:data
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { NetworkMeta } from '@gisalgo/shared';

export interface RawTag {
  k: string;
  v: string;
}

export interface RawNode {
  id: number;
  lat: number;
  lon: number;
  tags: RawTag[];
}

export interface RawWay {
  id: number;
  nds: number[];
  tags: RawTag[];
}

/** ref/json_structure.md 定义的原始 OSM JSON 顶层结构 */
export interface RawOsmJson {
  source_file?: string;
  nodes: RawNode[];
  ways: RawWay[];
  relations?: unknown[];
}

export interface PreparedWay {
  id: number;
  highway: string;
  name?: string;
  tags: Record<string, string>;
  nds: number[];
}

export interface EdgeTriple {
  from: number;
  to: number;
  wayId: number;
}

export interface DerivedFile {
  meta: NetworkMeta;
  /** [id, lat, lon] 紧凑数组 */
  nodes: [number, number, number][];
  ways: PreparedWay[];
}

export function parseTags(tags: RawTag[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags) out[t.k] = t.v;
  return out;
}

/** 只保留带 highway 标签的 way(道路) */
export function filterRoadWays(ways: RawWay[]): PreparedWay[] {
  const result: PreparedWay[] = [];
  for (const w of ways) {
    const tags = parseTags(w.tags);
    const highway = tags['highway'];
    if (highway === undefined) continue;
    const pw: PreparedWay = { id: w.id, highway, tags, nds: w.nds };
    if (tags['name'] !== undefined) pw.name = tags['name'];
    result.push(pw);
  }
  return result;
}

export function collectNodeIds(ways: PreparedWay[]): Set<number> {
  const ids = new Set<number>();
  for (const w of ways) {
    for (const n of w.nds) ids.add(n);
  }
  return ids;
}

/** 相邻 nds 对生成有向边;传入 nodeIds 时跳过缺失节点的边 */
export function buildEdges(ways: PreparedWay[], nodeIds?: Set<number>): EdgeTriple[] {
  const edges: EdgeTriple[] = [];
  for (const w of ways) {
    for (let i = 0; i + 1 < w.nds.length; i++) {
      const from = w.nds[i];
      const to = w.nds[i + 1];
      if (from === undefined || to === undefined) continue;
      if (nodeIds && (!nodeIds.has(from) || !nodeIds.has(to))) continue;
      edges.push({ from, to, wayId: w.id });
    }
  }
  return edges;
}

export function computeBbox(nodes: [number, number, number][]): NetworkMeta['bbox'] {
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;
  for (const [, lat, lon] of nodes) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function prepare(raw: RawOsmJson, generatedAt = new Date().toISOString()): DerivedFile {
  const ways = filterRoadWays(raw.ways);
  const nodeIds = collectNodeIds(ways);
  const nodes: [number, number, number][] = [];
  for (const n of raw.nodes) {
    if (nodeIds.has(n.id)) nodes.push([n.id, n.lat, n.lon]);
  }
  const edges = buildEdges(ways, nodeIds);
  const meta: NetworkMeta = {
    source: raw.source_file ?? 'unknown',
    generatedAt,
    nodeCount: nodes.length,
    wayCount: ways.length,
    edgeCount: edges.length,
    bbox: computeBbox(nodes),
  };
  return { meta, nodes, ways };
}

async function main(): Promise<void> {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const inFile = resolve(rootDir, 'data/wuhan.json');
  const outFile = resolve(rootDir, 'data/derived/wuhan-roads.json');

  console.time('读取+解析 wuhan.json');
  const raw = JSON.parse(readFileSync(inFile, 'utf8')) as RawOsmJson;
  console.timeEnd('读取+解析 wuhan.json');

  console.time('过滤+建边');
  const derived = prepare(raw);
  console.timeEnd('过滤+建边');

  mkdirSync(dirname(outFile), { recursive: true });
  console.time('写出派生文件');
  writeFileSync(outFile, JSON.stringify(derived));
  console.timeEnd('写出派生文件');

  console.log(`ways  = ${derived.meta.wayCount.toLocaleString()}`);
  console.log(`nodes = ${derived.meta.nodeCount.toLocaleString()}`);
  console.log(`edges = ${derived.meta.edgeCount.toLocaleString()}`);
  console.log(`bbox  = ${derived.meta.bbox.map((v) => v.toFixed(4)).join(', ')}`);
  console.log(`输出: ${outFile}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

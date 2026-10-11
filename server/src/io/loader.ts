/**
 * 数据装载:把派生路网文件读入内存(nodes/edges/GeoJSON)。
 * Sprint 1 起 Graph 类(C)将基于同一份产物构建邻接表。
 */
import { readFileSync } from 'node:fs';
import type {
  NetworkMeta,
  RoadEdge,
  RoadFeature,
  RoadFeatureCollection,
  WayProperties,
} from '@gisalgo/shared';

export interface LoadedNetwork {
  meta: NetworkMeta;
  /** OSM 节点 id → [lat, lon] */
  nodes: Map<number, [number, number]>;
  edges: RoadEdge[];
  geojson: RoadFeatureCollection;
}

interface DerivedWay {
  id: number;
  highway: string;
  name?: string;
  tags: Record<string, string>;
  nds: number[];
}

interface DerivedFile {
  meta: NetworkMeta;
  nodes: [number, number, number][];
  ways: DerivedWay[];
}

export function loadNetwork(fileUrl: URL): LoadedNetwork {
  const raw = JSON.parse(readFileSync(fileUrl, 'utf8')) as DerivedFile;

  const nodes = new Map<number, [number, number]>();
  for (const [id, lat, lon] of raw.nodes) nodes.set(id, [lat, lon]);

  const edges: RoadEdge[] = [];
  const features: RoadFeature[] = [];
  let edgeId = 0;

  for (const way of raw.ways) {
    for (let i = 0; i + 1 < way.nds.length; i++) {
      const from = way.nds[i];
      const to = way.nds[i + 1];
      if (from === undefined || to === undefined) continue;
      if (!nodes.has(from) || !nodes.has(to)) continue;
      edges.push({ id: edgeId++, from, to, wayId: way.id });
    }

    const coordinates: [number, number][] = [];
    for (const nodeId of way.nds) {
      const p = nodes.get(nodeId);
      if (p === undefined) continue;
      coordinates.push([p[1], p[0]]);
    }
    if (coordinates.length < 2) continue;

    const properties: WayProperties = { id: way.id, highway: way.highway, tags: way.tags };
    if (way.name !== undefined) properties.name = way.name;
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties });
  }

  return { meta: raw.meta, nodes, edges, geojson: { type: 'FeatureCollection', features } };
}

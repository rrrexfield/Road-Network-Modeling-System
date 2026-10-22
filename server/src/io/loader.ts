/**
 * 数据装载:把派生路网文件读入内存(nodes/ways/GeoJSON)。
 * 有向边由 topology 模块的 buildTopology 在组装阶段生成,本模块不再预构无向段。
 */
import { readFileSync } from 'node:fs';
import type {
  NetworkMeta,
  RoadFeature,
  RoadFeatureCollection,
  WayProperties,
} from '@gisalgo/shared';

/** 派生数据中的原始道路(含节点顺序),供 buildTopology 使用。 */
export interface LoadedWay {
  id: number;
  highway: string;
  name?: string;
  tags: Record<string, string>;
  nds: number[];
}

export interface LoadedNetwork {
  meta: NetworkMeta;
  /** OSM 节点 id → [lat, lon] */
  nodes: Map<number, [number, number]>;
  /** 原始道路(含 nds);方向判定与构边由 topology 模块负责。 */
  ways: LoadedWay[];
  geojson: RoadFeatureCollection;
}

interface DerivedFile {
  meta: NetworkMeta;
  nodes: [number, number, number][];
  ways: LoadedWay[];
}

export function loadNetwork(fileUrl: URL): LoadedNetwork {
  const raw = JSON.parse(readFileSync(fileUrl, 'utf8')) as DerivedFile;

  const nodes = new Map<number, [number, number]>();
  for (const [id, lat, lon] of raw.nodes) nodes.set(id, [lat, lon]);

  const features: RoadFeature[] = [];

  for (const way of raw.ways) {
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

  return {
    meta: raw.meta,
    nodes,
    ways: raw.ways,
    geojson: { type: 'FeatureCollection', features },
  };
}

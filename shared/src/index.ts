/**
 * 跨端契约:领域模型、API 出入参、WS 消息。
 * 本文件由 A 维护,变更需评审;前后端禁止各自重复定义契约类型。
 */

/** OSM 路网节点(WGS84 经纬度) */
export interface RoadNode {
  id: number;
  lat: number;
  lon: number;
}

/** 有向边:相邻 OSM 节点对,归属某条 way */
export interface RoadEdge {
  id: number;
  from: number;
  to: number;
  wayId: number;
}

/** 道路要素属性(点选面板展示内容) */
export interface WayProperties {
  id: number;
  name?: string;
  highway: string;
  tags: Record<string, string>;
}

export interface RoadFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: WayProperties;
}

export interface RoadFeatureCollection {
  type: 'FeatureCollection';
  features: RoadFeature[];
}

/** 派生数据文件元信息 */
export interface NetworkMeta {
  source: string;
  generatedAt: string;
  nodeCount: number;
  wayCount: number;
  /** 原始相邻节点段数(方向处理前);方向化后的有向边数由服务端装载后的 edges 长度给出 */
  segmentCount: number;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
}

export interface HealthResponse {
  status: 'ok';
  nodeCount: number;
  edgeCount: number;
  wayCount: number;
  uptime: number;
}

/** WS 消息信封,type 为判别字段 */
export type WSMessage =
  | { type: 'hello'; payload: { nodeCount: number; edgeCount: number; wayCount: number } }
  | { type: 'ping'; payload: { t: number } }
  | { type: 'pong'; payload: { t: number } };

/** highway 等级 → RGBA(0-255),深色底图配色 */
export const HIGHWAY_COLORS: Record<string, [number, number, number, number]> = {
  motorway: [255, 160, 70, 235],
  motorway_link: [255, 160, 70, 180],
  trunk: [255, 200, 100, 235],
  trunk_link: [255, 200, 100, 180],
  primary: [255, 225, 140, 225],
  primary_link: [255, 225, 140, 180],
  secondary: [190, 225, 170, 205],
  secondary_link: [190, 225, 170, 170],
  tertiary: [150, 200, 205, 195],
  residential: [130, 140, 165, 170],
  unclassified: [130, 140, 165, 170],
  living_street: [110, 120, 145, 150],
  service: [100, 110, 135, 140],
  pedestrian: [105, 115, 145, 120],
  footway: [105, 115, 145, 120],
  path: [105, 115, 145, 120],
  steps: [105, 115, 145, 110],
  cycleway: [120, 190, 150, 140],
  track: [115, 125, 150, 130],
};

const DEFAULT_COLOR: [number, number, number, number] = [125, 135, 160, 150];

export function highwayColor(highway: string): [number, number, number, number] {
  return HIGHWAY_COLORS[highway] ?? DEFAULT_COLOR;
}

/** highway 等级 → 线宽(米),配合 widthMinPixels 使用 */
const HIGHWAY_WIDTHS: Record<string, number> = {
  motorway: 10,
  motorway_link: 6,
  trunk: 9,
  trunk_link: 6,
  primary: 8,
  primary_link: 6,
  secondary: 7,
  secondary_link: 5,
  tertiary: 6,
  residential: 4.5,
  unclassified: 4.5,
  living_street: 4,
  service: 3,
  pedestrian: 2,
  footway: 1.5,
  path: 1.5,
  steps: 1.5,
  cycleway: 2,
  track: 2.5,
};

const DEFAULT_WIDTH = 3.5;

export function highwayWidth(highway: string): number {
  return HIGHWAY_WIDTHS[highway] ?? DEFAULT_WIDTH;
}

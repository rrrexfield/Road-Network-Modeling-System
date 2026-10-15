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

/** 路径结果（server 端 Dijkstra 输出，起点→终点）。 */
export interface PathResult {
  /**
   * 总代价；不可达为 Infinity（此时两个序列为空）。
   * 注意 Infinity 经 JSON.stringify 会变成 null，经 REST/WS 下发前须由 API 层转换。
   */
  distance: number;
  /** 起点→终点 节点 id 序列 */
  nodeIds: number[];
  /** 对应边 id 序列（比 nodeIds 少一项）；边 id 仅在同一次装载的图内有意义，不跨版本 */
  edgeIds: number[];
}

/** 拓扑统计报告（graph 模块 computeTopologyStats 输出）。度均为有向度（入度 + 出度）。 */
export interface TopologyStats {
  nodeCount: number;
  /** 图装载后按边 id 去重的有向边数；与 C 的 TopologyReport（原始相邻段数）口径不同 */
  edgeCount: number;
  /** 弱连通分量数（边视为无向） */
  connectedComponentCount: number;
  largestComponentSize: number;
  /**
   * 悬挂节点数（有向度 = 1）。M1 采用有向度口径：双向道路尽头（有向度 = 2）不判悬挂；
   * 无向物理邻接度口径的取舍见 issue #5 讨论，变更须走契约评审。
   */
  danglingNodeCount: number;
  /** 孤立节点数（有向度 = 0） */
  isolatedNodeCount: number;
  /** 平均度 = 2·edgeCount / nodeCount */
  averageDegree: number;
  /** 有向度 → 节点数。Map 不可 JSON 序列化，仅进程内使用，下发前须由 API 层转换。 */
  degreeDistribution: Map<number, number>;
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

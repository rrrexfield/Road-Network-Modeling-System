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

/**
 * GET /api/path 的响应体。
 *
 * 相比 `PathResult` 补充了两类前端必需的信息：
 * - `from` / `to`：请求里的经纬度被吸附到的实际节点坐标（[lon, lat]）；
 * - `coordinates`：整条路径的折线（[lon, lat]），前端可直接绘制，
 *   无需再按 edgeId 反查 way 几何。
 *
 * 采用 `extends` 而非修改 `PathResult`：后者已冻结（issue #4），
 * 这里只做非破坏性扩展。
 */
export interface PathResponse extends PathResult {
  /** 起点吸附到的节点坐标 [lon, lat] */
  from: [number, number];
  /** 终点吸附到的节点坐标 [lon, lat] */
  to: [number, number];
  /** 路径折线 [lon, lat][]，长度等于 nodeIds 长度 */
  coordinates: [number, number][];
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

/** 权重配置（路径优化目标 + 等级限速 + 全局速度系数）。 */
export interface WeightProfile {
  /** 优化目标：distance = 里程最短（米），time = 用时最短（秒）。 */
  metric: 'distance' | 'time';
  /** 全局速度系数，>0；1 表示各等级按默认限速。仅 metric='time' 时影响结果。 */
  speedFactor: number;
  /** 等级 → 限速（km/h）覆盖表，优先于默认表。仅 metric='time' 时影响结果。 */
  speedOverridesKmh: Record<string, number>;
}

/** 单个 highway 等级的统计口径。 */
export interface HighwayStat {
  highway: string;
  edgeCount: number;
  lengthMeters: number;
  /** 里程占比（0–1），按里程而非按条数。 */
  lengthShare: number;
  /** 按 lengthMeters / travelSeconds 反算的平均速度（km/h）；不可通行时为 0。 */
  averageSpeedKmh: number;
  travelSeconds: number;
}

/** 边长分布直方图的一档；maxMeters 为 null 表示最后一档无上界。 */
export interface LengthBucket {
  label: string;
  minMeters: number;
  maxMeters: number | null;
  edgeCount: number;
}

/**
 * 可序列化的拓扑指标（响应体形态）。
 * 由 `TopologyStats` 派生：仅 `degreeDistribution` 由 Map 摊成按度升序的数组，
 * 其余字段直接继承，禁止平铺副本。
 */
export interface TopologyMetrics extends Omit<TopologyStats, 'degreeDistribution'> {
  /** 有向度 → 节点数，按度升序。 */
  degreeDistribution: { degree: number; count: number }[];
}

/** 拓扑指标来源标注；用语义名而非模块路径，避免目录改名就失效。 */
export type TopologyMetricsSourceTag = 'graph-engine' | 'pending';

/**
 * 单个属性的完整率。
 * 口径：**按 way 统计**（属性来自 way 标签），不是按有向边逐条统计——
 * 同一 way 的标签会被拆成多条有向边，按边统计会把完整率重复稀释。
 */
export interface AttributeCompleteness {
  /** 已填写该属性的 way 数。 */
  filled: number;
  /** 参与统计的 way 总数。 */
  total: number;
  /** 完整率，0–1；等于 filled / total。 */
  ratio: number;
}

/** 若干属性的完整率集合。 */
export interface AttributeCompletenessReport {
  name: AttributeCompleteness;
  maxspeed: AttributeCompleteness;
  lanes: AttributeCompleteness;
  surface: AttributeCompleteness;
  oneway: AttributeCompleteness;
}

/** 网络统计响应体（GET /api/stats）。 */
export interface NetworkStats {
  /** 坐标表节点数。 */
  nodeCount: number;
  /** 参与统计的边数（端点缺失的边不计入）。 */
  edgeCount: number;
  /** 出现过的 way 数（按边集去重）。 */
  wayCount: number;
  totalLengthMeters: number;
  /** 按当前限速估算的总通行时间；与 profile.metric 无关——metric 只决定路径优化的目标。 */
  totalTravelSeconds: number;
  minEdgeMeters: number;
  maxEdgeMeters: number;
  meanEdgeMeters: number;
  medianEdgeMeters: number;
  byHighway: HighwayStat[];
  lengthHistogram: LengthBucket[];
  /** 拓扑指标；图引擎未接入时为 null。 */
  topology: TopologyMetrics | null;
  topologySource: TopologyMetricsSourceTag;
  /**
   * 道路属性完整率。**缺省表示服务端尚未提供该统计**（实现落地前前端不展示该区块，
   * 不得以 0 冒充完整率）；实现落地后由 A 评审收紧为必填。
   */
  attributeCompleteness?: AttributeCompletenessReport;
  /** 本次统计所用的权重配置，便于前端回显。 */
  profile: WeightProfile;
}

/** 权重配置基线响应（GET /api/weights/profile）。 */
export interface WeightProfileResponse {
  default: WeightProfile;
  /** 各等级默认限速（km/h），前端面板据此渲染限速输入项。 */
  speedTable: Readonly<Record<string, number>>;
}

/* ==================== Sprint 2 · 转向限制与多模态 ==================== */

/**
 * 交通模态。Sprint 2 的四模态子图按此枚举过滤，与 `GET /api/network?mode=`、
 * `GET /api/transfer-points?mode=` 的 `mode` 取值一致。
 */
export type TravelMode = 'car' | 'walk' | 'bike' | 'bus';

/**
 * 转向限制类型。含 OSM 的 only_* 变体（专用车道：除该方向外其余转向一律禁止）。
 * 存储与算法判定一律使用 (fromEdge, toEdge) 边对；本字段只描述禁转的语义类别。
 */
export type TurnRestrictionType =
  | 'no_left_turn'
  | 'no_right_turn'
  | 'no_u_turn'
  | 'no_straight_on'
  | 'only_left_turn'
  | 'only_right_turn'
  | 'only_straight_on'
  | 'only_u_turn';

/**
 * 转向动作的几何分类，**仅供展示**。
 * 方位角差落入明确区间才给出四分类；模糊地带回退 'ambiguous'，
 * 由前端改显「驶入<道路名>（左偏 75°）」。
 */
export type TurnKind = 'left' | 'right' | 'straight' | 'u_turn' | 'ambiguous';

/** 一条禁转规则：在 viaNode 处，禁止从 fromEdge 转入 toEdge。 */
export interface TurnRestriction {
  id: number;
  /** 禁转所在路口（节点）id。 */
  viaNode: number;
  /** 入口边 id。 */
  fromEdge: number;
  /** 目标边 id。 */
  toEdge: number;
  /**
   * 禁转语义类别。由服务端按几何方位角判定后写入；
   * 客户端只提交边对，不直接指定本字段。
   */
  type: TurnRestrictionType;
  /** 'osm' 为导入所得，'manual' 为用户在编辑器中设置。 */
  source: 'osm' | 'manual';
}

/** 路口的一个转向动作（编辑器清单的一行）。 */
export interface TurnAction {
  fromEdge: number;
  toEdge: number;
  /** 入口边所属 way id，用于显示道路名。 */
  fromWayId: number;
  /** 目标边所属 way id，用于显示道路名。 */
  toWayId: number;
  /** 几何分类，仅用于展示。 */
  turnKind: TurnKind;
  /** 方位角差（度）：目标边方位角 − 入口边方位角，顺时针（右）为正。 */
  angleDelta: number;
  /** 该转向当前是否被禁止。 */
  forbidden: boolean;
  /** 该禁转是否来自 OSM 导入（用于与用户手动设置区分展示）。 */
  fromOsm: boolean;
}

/** `GET /api/intersections/:nodeId/turns` 响应。 */
export interface IntersectionTurns {
  nodeId: number;
  /** 路口位置 [lon, lat]。 */
  position: [number, number];
  /** 该路口的全部转向动作。 */
  turns: TurnAction[];
}

/**
 * `PUT /api/intersections/:nodeId/turns` 请求体。
 * 语义为**整体覆盖该路口的禁转集合**（编辑器是「完整转向清单 + 勾选」），
 * 不是逐条增删，以避免部分成功导致的状态不一致。
 */
export interface SetIntersectionTurnsRequest {
  forbidden: Array<{ fromEdge: number; toEdge: number }>;
}

/** `PUT /api/intersections/:nodeId/turns` 响应。 */
export interface SetIntersectionTurnsResponse {
  ok: true;
  /** 覆盖后该路口的禁转规则条数。 */
  restrictionCount: number;
}

/** 模态转换点（地铁站 / 公交站 / 停车场）。 */
export interface TransferPoint {
  id: number;
  kind: 'subway' | 'bus' | 'parking';
  /** 站名或停车场名；无名时缺省。 */
  name?: string;
  /** 位置 [lon, lat]。 */
  position: [number, number];
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

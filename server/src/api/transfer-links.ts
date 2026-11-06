/**
 * 跨模态换乘连接表(issue #34):把模态转换点落成「模态 A 的某节点 ↔ 模态 B 的某节点」的连接,
 * 供 B 的跨模态搜索在模态切换边上加权。
 *
 * 为什么不能直接拿转换点的代表点当换乘位置:
 * - way 型设施(停车场、站台面)的代表点是**包围盒中心**,不是真实出入口,用它当连接点
 *   会把连接接到一条根本不存在的路上;
 * - node 型设施(公交站、地铁出入口、点型停车场)的 OSM 节点**可能不在任何道路的节点序列里**,
 *   即"设施节点"与"路网节点"是两个东西,中间有一段真实的接驳步行。
 *
 * 本模块的做法(与 C 的 `matchTransferConnections` 口径一致,不另造一套):
 * 1. 对每个模态,用 C 的匹配器找出该模态图上离设施最近的节点,并保留**证据类型**:
 *    - `shared-osm-node`:设施自身的 OSM 节点就是该模态图的节点(同一个节点,连接是精确的);
 *    - `nearby-candidate`:设施节点不在该模态图里,取半径内的最近节点(几何近似,未核验)。
 * 2. 只有当两个模态各自的节点都存在、且两者之间的**接驳距离**不超过上限时,才建立连接。
 * 3. 换乘罚时 = 接驳步行时间 + 等待时间,等待时间取 D 的 `transferPenaltySeconds(kind)`
 *    (占位值,标定计划见 docs/plans/d-sprint2-weights-stats.md §2),
 *    接驳步行时间由 C 的 `computeTransferPenalty` 按显式输入的步行距离与速度计算。
 *
 * 口径纪律:
 * - **不声称物理可达**:`nearby-candidate` 只是几何近似,证据类型随连接一起保留,
 *   前端与文档都能看到"这条换乘是近邻近似"而不是"已核验入口";
 * - way 型设施一律不建连接(C 的匹配器直接判为 `entrance-required`),因为缺少出入口证据;
 * - 换乘罚时属于**时间/成本**口径,不计入 `PathResult.distance`(契约 issue #34 决策)。
 */
import type { TravelMode } from '@gisalgo/shared';
import type { TransferPointData } from '../io/index.js';
import { computeTransferPenalty, matchTransferConnections } from '../topology/index.js';
import { haversineMeters, transferPenaltySeconds } from '../weights/index.js';

/** 各模态的近邻候选半径(米):设施节点到该模态路网节点的最远搜索距离。 */
export const CANDIDATE_RADIUS_METERS: Record<TravelMode, number> = {
  car: 100,
  walk: 200,
  bike: 100,
  bus: 100,
};

/**
 * 接驳距离上限(米):两个模态节点之间的实际步行距离上限。
 * 步行侧放宽到 200 m(作业二 issue #34 给出的步行接驳阈值),其余模态取 100 m。
 */
export const ACCESS_LIMIT_METERS: Record<TravelMode, number> = {
  car: 100,
  walk: 200,
  bike: 100,
  bus: 100,
};

/** 接驳步行速度(米/秒),约 4.7 km/h,用于把接驳距离换算成时间。 */
export const ACCESS_WALK_SPEED_MPS = 1.3;

/** 连接证据:`shared-osm-node` 为精确同节点,`nearby-candidate` 为半径内近邻近似。 */
export type TransferEvidence = 'shared-osm-node' | 'nearby-candidate';

/** 一条模态之间的换乘连接。 */
export interface TransferLinkEntry {
  /** 转换点 id(与 shared 的 TransferPoint.id 一致)。 */
  transferPointId: number;
  /** 设施类型,决定等待罚时取值。 */
  kind: 'subway' | 'bus' | 'parking';
  fromMode: TravelMode;
  /** 换乘点在 `fromMode` 图上的节点 id。 */
  fromNodeId: number;
  toMode: TravelMode;
  /** 换乘点在 `toMode` 图上的节点 id。 */
  toNodeId: number;
  /** 两个模态节点之间的接驳距离(米,球面距离)。 */
  accessMeters: number;
  /** 换乘罚时(秒):接驳步行时间 + 等待时间。 */
  penaltySeconds: number;
  evidence: TransferEvidence;
}

/** 各模态的节点表(OSM 节点 id → [lat, lon])。 */
export type ModalNodeTables = Partial<
  Record<TravelMode, ReadonlyMap<number, readonly [number, number]>>
>;

/** 单个(转换点, 模态)的匹配结果。 */
interface Attachment {
  nodeId: number;
  distanceM: number;
  evidence: TransferEvidence;
}

/**
 * 构建跨模态换乘连接表。
 *
 * @param data 转换点及其来源(必须带来源,否则无法判断设施类型与可用模态)。
 * @param networks 需要参与换乘的模态节点表;未提供的模态不建连接。
 * @returns 全部可用的换乘连接(有向:car→walk 与 walk→car 是两条不同的连接)。
 * @remarks 复杂度 O(转换点数 × 模态数 × 半径内候选数);候选查找用 C 的网格索引,
 * 不做全图扫描。way 型设施与并列近邻(ambiguous-nearest)不会出现在结果里——
 * 前者缺出入口证据,后者无法确定该接哪个节点。
 */
export function buildTransferLinks(
  data: TransferPointData,
  networks: ModalNodeTables,
): TransferLinkEntry[] {
  const modes = (Object.keys(networks) as TravelMode[]).filter(
    (mode) => networks[mode] !== undefined,
  );
  if (modes.length === 0) return [];

  // 每个模态:设施 → 该模态图上的节点(含证据)
  const attachments = new Map<string, Attachment>();
  for (const mode of modes) {
    // 匹配器的候选半径是**整次调用**共用的,而各模态的半径不同(步行 200 m,其余 100 m),
    // 故每次只把一个模态交给它——其它模态会被判为 mode-not-loaded 而跳过。
    const report = matchTransferConnections(
      data,
      { [mode]: networks[mode] },
      CANDIDATE_RADIUS_METERS[mode],
    );
    for (const match of report.matches) {
      // 防御性过滤:匹配器对设施的每个支持模态都会给匹配,只取当前模态的。
      if (match.mode !== mode) continue;
      attachments.set(`${match.pointId}:${mode}`, {
        nodeId: match.nodeId,
        distanceM: match.distanceM,
        evidence: match.evidence,
      });
    }
  }

  const points = new Map(data.points.map((point) => [point.id, point]));
  const links: TransferLinkEntry[] = [];

  for (const source of data.sources) {
    const point = points.get(source.pointId);
    if (point === undefined) continue;
    // 设施类型决定等待罚时;地铁站目前只归属 walk,构不成模态切换,自然不会出现在结果里。
    const kind = point.kind;

    for (const fromMode of source.modes) {
      const from = attachments.get(`${source.pointId}:${fromMode}`);
      if (from === undefined) continue;
      const fromCoord = networks[fromMode]?.get(from.nodeId);
      if (fromCoord === undefined) continue;

      for (const toMode of source.modes) {
        if (toMode === fromMode) continue;
        const to = attachments.get(`${source.pointId}:${toMode}`);
        if (to === undefined) continue;
        const toCoord = networks[toMode]?.get(to.nodeId);
        if (toCoord === undefined) continue;

        const accessMeters = haversineMeters(fromCoord, toCoord);
        if (accessMeters > ACCESS_LIMIT_METERS[toMode]) continue;

        const penaltySeconds = computeTransferPenalty({
          walkingDistanceM: accessMeters,
          walkingSpeedMps: ACCESS_WALK_SPEED_MPS,
          waitingSeconds: transferPenaltySeconds(kind),
        });

        links.push({
          transferPointId: source.pointId,
          kind,
          fromMode,
          fromNodeId: from.nodeId,
          toMode,
          toNodeId: to.nodeId,
          accessMeters,
          penaltySeconds,
          evidence: from.evidence === 'shared-osm-node' && to.evidence === 'shared-osm-node'
            ? 'shared-osm-node'
            : 'nearby-candidate',
        });
      }
    }
  }

  return links;
}

/** 连接诊断:按证据类型与模态对统计,用于接口自检与文档口径核对。 */
export interface TransferLinkDiagnostics {
  linkCount: number;
  byEvidence: Record<TransferEvidence, number>;
  byModePair: Record<string, number>;
  /** 接驳距离(米)的最大值,用于观察近邻近似的粗糙程度。 */
  maxAccessMeters: number;
}

/**
 * 汇总连接表诊断。
 * @param links 连接表。
 * @returns 按证据类型、模态对与最大接驳距离统计的诊断。
 */
export function summarizeTransferLinks(links: readonly TransferLinkEntry[]): TransferLinkDiagnostics {
  const byEvidence: Record<TransferEvidence, number> = {
    'shared-osm-node': 0,
    'nearby-candidate': 0,
  };
  const byModePair: Record<string, number> = {};
  let maxAccessMeters = 0;
  for (const link of links) {
    byEvidence[link.evidence] += 1;
    const key = `${link.fromMode}->${link.toMode}`;
    byModePair[key] = (byModePair[key] ?? 0) + 1;
    if (link.accessMeters > maxAccessMeters) maxAccessMeters = link.accessMeters;
  }
  return { linkCount: links.length, byEvidence, byModePair, maxAccessMeters };
}

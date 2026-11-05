/**
 * 路口就近查询:把「点击的经纬度」映射为「可编辑的路口节点 ID」。
 *
 * 背景(issue #43):转向限制编辑器需要 OSM Node ID 才能查询转向,而路网 GeoJSON
 * 按 Way 组织、不含节点 ID,前端无法从地图点击反推路口。
 *
 * 路口判定口径(冻结于 shared 的 NearestIntersectionResponse):
 * - 只在**当前模态的拓扑**中判定,不同模态可返回不同的路口集合;
 * - 该节点在当前模态下至少连接 3 个**不同邻接节点**(排除 degree=2 的道路折点、
 *   普通中间节点、悬挂端点与孤立节点);
 * - 按球面距离(haversine)计算命中距离,不用经纬度欧氏距离;
 * - 超出阈值一律不命中,不返回"最近但很远"的节点。
 *
 * 性能:模态拓扑有 62.8 万节点 / ~100 万边,逐节点线性扫描不可接受,
 * 故用经纬度网格把候选集缩小到点击位置附近。
 */
import type { NearestIntersectionResponse, RoadEdge } from '@gisalgo/shared';
import { haversineMeters } from '../weights/index.js';

/** 网格边长（度）。0.001° 约 111 m，远小于默认的 15 m 命中阈值。 */
const CELL = 0.001;

/** 经度方向的网格数（用于环绕）。 */
const WIDTH = 360 / CELL;

/** 路口最小邻接节点数：3 才算交叉路口，2 是道路折点。 */
export const MIN_INTERSECTION_DEGREE = 3;

/** 默认命中半径（米）。 */
export const DEFAULT_MAX_DISTANCE_M = 15;

/** 命中半径上限（米）：防止前端传入过大的阈值导致全图扫描。 */
export const MAX_MAX_DISTANCE_M = 100;

function wrap(x: number): number {
  return ((x % WIDTH) + WIDTH) % WIDTH;
}

function positionValid(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

/**
 * 路口就近索引:按网格组织节点,并预计算每个节点的邻接节点数。
 *
 * 邻接节点数按**去重后的邻接节点**统计，而不是按边数统计——
 * 一条双向道路在路口处会贡献入边与出边两条边，但只有一个邻接节点。
 * 用边数会把「两臂路口」误判成交叉路口。
 */
export class IntersectionIndex {
  /** 网格键 → 该格内的节点 ID。 */
  private readonly cells = new Map<string, number[]>();
  /** 节点 ID → 去重后的邻接节点数。 */
  private readonly degrees = new Map<number, number>();
  /** 节点 ID → 与该节点相连的 Way ID（去重）。 */
  private readonly wayIds = new Map<number, Set<number>>();

  constructor(
    private readonly nodes: ReadonlyMap<number, readonly [number, number]>,
    edges: readonly RoadEdge[],
  ) {
    // 统计每个节点的不同邻接节点
    const neighbors = new Map<number, Set<number>>();
    for (const edge of edges) {
      const fromSet = neighbors.get(edge.from) ?? new Set<number>();
      fromSet.add(edge.to);
      neighbors.set(edge.from, fromSet);
      const toSet = neighbors.get(edge.to) ?? new Set<number>();
      toSet.add(edge.from);
      neighbors.set(edge.to, toSet);

      const fromWays = this.wayIds.get(edge.from) ?? new Set<number>();
      fromWays.add(edge.wayId);
      this.wayIds.set(edge.from, fromWays);
      const toWays = this.wayIds.get(edge.to) ?? new Set<number>();
      toWays.add(edge.wayId);
      this.wayIds.set(edge.to, toWays);
    }
    for (const [id, set] of neighbors) {
      this.degrees.set(id, set.size);
      const point = nodes.get(id);
      if (point === undefined || !positionValid(point[0], point[1])) continue;
      const key = `${Math.floor(point[0] / CELL)}:${wrap(Math.floor((point[1] + 180) / CELL))}`;
      const ids = this.cells.get(key) ?? [];
      ids.push(id);
      this.cells.set(key, ids);
    }
  }

  /**
   * 取点击位置附近的候选节点 ID。
   *
   * @param lat 点击纬度。
   * @param lon 点击经度。
   * @param radiusM 搜索半径（米）。
   */
  private candidates(lat: number, lon: number, radiusM: number): number[] {
    // 110 km/度作为保守的纬度包围范围，最终仍用球面距离筛选。
    const latSpan = radiusM / 110000;
    const cosine = Math.cos((Math.min(90, Math.abs(lat) + latSpan) * Math.PI) / 180);
    const lonSpan = cosine < 1e-6 ? 180 : Math.min(180, latSpan / cosine);
    const ymin = Math.floor((lat - latSpan) / CELL);
    const ymax = Math.floor((lat + latSpan) / CELL);
    const xmin = Math.floor((lon + 180 - lonSpan) / CELL);
    const xmax = Math.floor((lon + 180 + lonSpan) / CELL);
    // 网格范围过大时放弃网格，退化为全量扫描（此时半径已被上限约束，不会失控）
    if ((ymax - ymin + 1) * (xmax - xmin + 1) > 10000) return [...this.nodes.keys()];
    const result = new Set<number>();
    for (let y = ymin; y <= ymax; y++) {
      for (let x = xmin; x <= xmax; x++) {
        for (const id of this.cells.get(`${y}:${wrap(x)}`) ?? []) result.add(id);
      }
    }
    return [...result];
  }

  /**
   * 查点击位置最近的**可编辑路口**。
   *
   * @param lat 点击纬度。
   * @param lon 点击经度。
   * @param maxDistanceM 命中半径（米）。
   * @param wayNames wayId → 道路名称，用于回填道路名。
   * @returns 命中的路口；无路口在阈值内时返回 null。
   */
  findNearest(
    lat: number,
    lon: number,
    maxDistanceM: number,
    wayNames: ReadonlyMap<number, string>,
  ): NearestIntersectionResponse | null {
    let best: { nodeId: number; distance: number } | null = null;
    for (const id of this.candidates(lat, lon, maxDistanceM)) {
      // 只保留真正的交叉路口：邻接节点数 >= 3
      if ((this.degrees.get(id) ?? 0) < MIN_INTERSECTION_DEGREE) continue;
      const point = this.nodes.get(id);
      if (point === undefined) continue;
      const distance = haversineMeters([lat, lon], point);
      if (distance > maxDistanceM) continue;
      if (best === null || distance < best.distance) {
        best = { nodeId: id, distance };
      }
    }
    if (best === null) return null;

    const point = this.nodes.get(best.nodeId)!;
    const connectedWayIds = [...(this.wayIds.get(best.nodeId) ?? new Set<number>())].sort(
      (a, b) => a - b,
    );
    // 道路名去重且保持稳定顺序；无名道路不计入。
    const roadNames: string[] = [];
    for (const wayId of connectedWayIds) {
      const name = wayNames.get(wayId);
      if (name !== undefined && !roadNames.includes(name)) roadNames.push(name);
    }
    return {
      nodeId: best.nodeId,
      position: [point[1], point[0]],
      distanceMeters: best.distance,
      degree: this.degrees.get(best.nodeId) ?? 0,
      connectedWayIds,
      roadNames,
    };
  }
}

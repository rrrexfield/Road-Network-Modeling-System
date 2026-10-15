import type { RoadEdge } from '@gisalgo/shared';

const EARTH_RADIUS_M = 6371000;

/** 两点球面距离（米），Haversine 公式。入参为 [lat, lon]。 */
function haversine(a: readonly [number, number], b: readonly [number, number]): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]);
  const la2 = toRad(b[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/**
 * 有向路网图：邻接表 + Float32Array 紧凑坐标 + 预计算边长。
 * 构造入参直接匹配 C 的 buildTopology() 产物（nodes Map + edges RoadEdge[]），无需适配层。
 */
export class Graph {
  /** 节点 id → 内部连续下标（0..n-1） */
  private nodeIndex = new Map<number, number>();
  /** 稠密下标 → 节点 id（nodeIndex 的逆查询） */
  private ids: number[] = [];
  private lat = new Float32Array(0);
  private lon = new Float32Array(0);
  /** 出边邻接表：节点 id → 以其为起点的边 */
  private outAdj = new Map<number, RoadEdge[]>();
  private edgesById = new Map<number, RoadEdge>();
  private inDeg = new Map<number, number>();
  /** 边 id → 预计算球面长度（米），装载时一次算好，供默认边权 O(1) 读取 */
  private edgeLen = new Map<number, number>();

  constructor(
    nodes: ReadonlyMap<number, readonly [number, number]>,
    edges: readonly RoadEdge[],
  ) {
    for (const [id, coord] of nodes) this.addNode(id, coord);
    for (const e of edges) this.addEdge(e);
  }

  get nodeCount(): number {
    return this.nodeIndex.size;
  }

  get edgeCount(): number {
    return this.edgesById.size;
  }

  hasNode(id: number): boolean {
    return this.nodeIndex.has(id);
  }

  /** 节点 id → 稠密下标（0..n-1）；不存在返回 undefined。 */
  indexOf(id: number): number | undefined {
    return this.nodeIndex.get(id);
  }

  /** 稠密下标 → 节点 id（indexOf 的逆查询）。 */
  idAt(index: number): number {
    return this.ids[index]!;
  }

  /** 预计算边长（米，Haversine）；未装载的边 id 返回 Infinity。 */
  edgeLength(id: number): number {
    return this.edgeLen.get(id) ?? Infinity;
  }

  coordinates(id: number): readonly [number, number] | undefined {
    const i = this.nodeIndex.get(id);
    if (i === undefined) return undefined;
    return [this.lat[i]!, this.lon[i]!];
  }

  /** 只读视图：返回内部邻接数组，调用方不得修改；遍历中不得变更图结构。 */
  outEdges(id: number): readonly RoadEdge[] {
    return this.outAdj.get(id) ?? [];
  }

  outDegree(id: number): number {
    return this.outAdj.get(id)?.length ?? 0;
  }

  inDegree(id: number): number {
    return this.inDeg.get(id) ?? 0;
  }

  /** 只读迭代器：遍历中变更图会产生未定义行为。 */
  nodes(): IterableIterator<number> {
    return this.nodeIndex.keys();
  }

  /** 只读迭代器：遍历中变更图会产生未定义行为。 */
  edges(): IterableIterator<RoadEdge> {
    return this.edgesById.values();
  }

  /** 新增节点；坐标非法（非有限数，NaN 坐标会使关联边在寻路中被静默丢弃）时抛错；已存在的 id 忽略。 */
  addNode(id: number, coord: readonly [number, number]): void {
    if (this.nodeIndex.has(id)) return;
    if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) {
      throw new Error(`addNode 坐标非法: ${id} [${coord[0]}, ${coord[1]}]`);
    }
    const i = this.nodeIndex.size;
    this.nodeIndex.set(id, i);
    this.ids.push(id);
    if (i >= this.lat.length) this.grow(i + 1);
    this.lat[i] = coord[0];
    this.lon[i] = coord[1];
  }

  /** 新增边；端点必须已存在，否则抛错。 */
  addEdge(edge: RoadEdge): void {
    if (this.edgesById.has(edge.id)) return;
    if (!this.nodeIndex.has(edge.from) || !this.nodeIndex.has(edge.to)) {
      throw new Error(`addEdge 端点不存在: ${edge.from} → ${edge.to}`);
    }
    this.edgesById.set(edge.id, edge);
    const list = this.outAdj.get(edge.from);
    if (list === undefined) this.outAdj.set(edge.from, [edge]);
    else list.push(edge);
    this.inDeg.set(edge.to, (this.inDeg.get(edge.to) ?? 0) + 1);
    this.edgeLen.set(edge.id, haversine(this.coordinates(edge.from)!, this.coordinates(edge.to)!));
  }

  removeEdge(edgeId: number): boolean {
    const edge = this.edgesById.get(edgeId);
    if (edge === undefined) return false;
    this.edgesById.delete(edgeId);
    this.edgeLen.delete(edgeId);
    const list = this.outAdj.get(edge.from);
    if (list !== undefined) {
      const idx = list.findIndex((e) => e.id === edgeId);
      if (idx !== -1) list.splice(idx, 1);
    }
    const deg = this.inDeg.get(edge.to);
    if (deg !== undefined) this.inDeg.set(edge.to, deg - 1);
    return true;
  }

  private grow(minSize: number): void {
    let cap = this.lat.length === 0 ? 1 : this.lat.length;
    while (cap < minSize) cap *= 2;
    const nextLat = new Float32Array(cap);
    const nextLon = new Float32Array(cap);
    nextLat.set(this.lat);
    nextLon.set(this.lon);
    this.lat = nextLat;
    this.lon = nextLon;
  }
}

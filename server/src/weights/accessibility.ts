/**
 * 可达性分析(Sprint 3 · 作业三,issue #65):等时圈口径——给定起点与时间预算,
 * 统计预算内可达的节点数与里程分布。
 *
 * **口径纪律(答辩抽问点)**:
 * 1. **按边统计里程,不按 way**——一条 way 可能横跨可达与不可达区域,按 way 整条计入
 *    会系统性高估;有向边是最小几何单元,与 /api/stats 的里程统计口径一致(都按边聚合)。
 * 2. **边计入条件 = 两端点都在预算内**——只有起点端可达时,沿该边的剩余部分是否可达
 *    未知,只算端点会把"半条边"伪装成整条边;两端可达是"整条边可整体在预算内通过"
 *    的充分条件的保守近似,不会高估。
 * 3. **搜索为限界 Dijkstra(预算早停)**——与 B 的全路径 Dijkstra 职责不同:B 返回
 *    单起终点完整路径,这里只需要"预算内能到哪些节点",堆中最小距离超过预算即停,
 *    不需要目标节点与路径还原。算法仍按课程要求自写(不引第三方库)。
 *
 * 时间权重与 /api/path 完全同源:`createModeEdgeWeight`(模态速度 + 权重配置 +
 * 拥堵时间槽 + 事件),保证"等时圈"与"路径时间"两个口径不打架。
 */
import type { RoadEdge, TravelMode } from '@gisalgo/shared';
import { haversineMeters } from './geo.js';
import { createModeEdgeWeight } from './mode-weight.js';
import { DEFAULT_WEIGHT_PROFILE, UNKNOWN_HIGHWAY, type WeightProfile } from './weight.js';
import { clampHourOfDay, type TrafficConditions } from './traffic.js';

/** 可达性统计报告(响应结构草案;冻结到 shared 前为本模块本地类型,见 issue [D → A] 契约草案)。 */
export interface AccessibilityReport {
  /** 起点节点 id。 */
  originNode: number;
  /** 时间预算(秒)。 */
  budgetSeconds: number;
  /** 交通模态。 */
  mode: TravelMode;
  /** 预算内可达节点数(含起点)。 */
  reachableNodeCount: number;
  /** 两端均可达的有向边数。 */
  reachableEdgeCount: number;
  /** 上述边的里程合计(米),口径见文件头注释。 */
  reachableLengthMeters: number;
  /** 按等级聚合的可达里程(按里程降序)。 */
  byHighway: Array<{
    highway: string;
    edgeCount: number;
    lengthMeters: number;
    lengthShare: number;
  }>;
  /** 是否触达搜索安全上限(正常为 false;true 表示结果被截断,仅防御性保留)。 */
  truncated: boolean;
  /** 参与计算的权重配置(与 NetworkStats.profile 同构)。 */
  profile: WeightProfile;
  /** 交通条件回显;未启用拥堵/事件时为 null。 */
  traffic: {
    hourOfDay: number;
    congestionEnabled: boolean;
    appliedEventCount: number;
  } | null;
}

/** 可达性输入:与 StatsInput 同构(坐标表 + 边集 + way→等级表 + 可选边长注入)。 */
export interface AccessibilityInput {
  nodes: ReadonlyMap<number, readonly [number, number]>;
  edges: readonly RoadEdge[];
  wayHighway: ReadonlyMap<number, string>;
  /** 边长注入(米);未提供回退本地 Haversine,口径说明见 stats.ts。 */
  edgeLength?: (edge: RoadEdge) => number;
}

/** 搜索安全上限:弹堆次数超过即截断(防御网络异常超大预算,正常等时圈远达不到)。 */
const MAX_HEAP_POPS = 500_000;

/** 轻量二叉最小堆:[距离, 节点]。 */
class MinHeap {
  private items: Array<[number, number]> = [];

  get size(): number {
    return this.items.length;
  }

  push(item: [number, number]): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]![0] <= this.items[i]![0]) break;
      [this.items[parent], this.items[i]] = [this.items[i]!, this.items[parent]!];
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length === 0 || last === undefined) return top;
    this.items[0] = last;
    const n = this.items.length;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.items[left]![0] < this.items[smallest]![0]) smallest = left;
      if (right < n && this.items[right]![0] < this.items[smallest]![0]) smallest = right;
      if (smallest === i) break;
      [this.items[smallest], this.items[i]] = [this.items[i]!, this.items[smallest]!];
      i = smallest;
    }
    return top;
  }
}

/** 按起点端建邻接表(有向);同一条 from 节点的出边聚在一起。复杂度 O(E)。 */
function buildAdjacency(edges: readonly RoadEdge[]): Map<number, RoadEdge[]> {
  const adjacency = new Map<number, RoadEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (list === undefined) adjacency.set(edge.from, [edge]);
    else list.push(edge);
  }
  return adjacency;
}

/**
 * 等时圈可达性统计。
 * @param input 网络输入(坐标表、边集、way→等级表、可选边长注入)。
 * @param originNode 起点节点 id;不存在于坐标表时返回 null(由路由层转 404)。
 * @param budgetMinutes 时间预算(分钟),>0;换算为秒参与比较。
 * @param options.mode 交通模态,默认 car;profile 权重配置;traffic 交通条件(拥堵/事件)。
 * @returns 可达性报告;结构与既有统计一致(按等级聚合 + 总量 KPI)。
 * @remarks 复杂度 O(E + V log V):建邻接表 O(E),限界 Dijkstra 每条边至多松弛一次。
 * 同一输入重复调用结果逐位相同(确定性;权重为查表 + 插值,无随机成分)。
 */
export function computeAccessibility(
  input: AccessibilityInput,
  originNode: number,
  budgetMinutes: number,
  options?: {
    mode?: TravelMode;
    profile?: WeightProfile;
    traffic?: TrafficConditions;
  },
): AccessibilityReport | null {
  if (!input.nodes.has(originNode)) return null;
  const budgetMinutesSafe =
    Number.isFinite(budgetMinutes) && budgetMinutes > 0 ? Math.min(budgetMinutes, 720) : 15;
  const budgetSeconds = budgetMinutesSafe * 60;

  const mode = options?.mode ?? 'car';
  const traffic = options?.traffic;
  const hourOfDay = traffic ? clampHourOfDay(traffic.hourOfDay) : 0;
  // 传入 traffic 即启用拥堵(默认曲线),congestionDisabled 显式关闭;本层忠实执行解析结果。
  const congestionEnabled = traffic !== undefined && traffic.congestionDisabled !== true;
  const appliedEventCount = traffic?.events?.length ?? 0;

  const weightOf = createModeEdgeWeight(
    { nodes: input.nodes, wayHighway: input.wayHighway },
    mode,
    options?.profile ?? DEFAULT_WEIGHT_PROFILE,
    traffic,
  );

  const adjacency = buildAdjacency(input.edges);
  const best = new Map<number, number>([[originNode, 0]]);
  const heap = new MinHeap();
  heap.push([0, originNode]);
  let pops = 0;
  let truncated = false;

  while (heap.size > 0) {
    const [dist, node] = heap.pop()!;
    if (dist > (best.get(node) ?? Number.POSITIVE_INFINITY)) continue; // 过期堆项
    if (dist > budgetSeconds) break; // 预算早停:堆中已无更近节点
    pops += 1;
    if (pops > MAX_HEAP_POPS) {
      truncated = true;
      break;
    }
    for (const edge of adjacency.get(node) ?? []) {
      const weight = weightOf(edge);
      if (!Number.isFinite(weight)) continue; // 封闭/不可通行边
      const next = dist + weight;
      if (next > budgetSeconds) continue;
      const known = best.get(edge.to);
      if (known === undefined || next < known) {
        best.set(edge.to, next);
        heap.push([next, edge.to]);
      }
    }
  }

  const byHighway = new Map<string, { edgeCount: number; lengthMeters: number }>();
  let reachableEdgeCount = 0;
  let reachableLengthMeters = 0;
  for (const edge of input.edges) {
    const from = best.get(edge.from);
    const to = best.get(edge.to);
    if (from === undefined || to === undefined) continue; // 两端均可达才计入(口径见文件头)
    const fromXY = input.nodes.get(edge.from);
    const toXY = input.nodes.get(edge.to);
    if (fromXY === undefined || toXY === undefined) continue;
    const lengthMeters = input.edgeLength?.(edge) ?? haversineMeters(fromXY, toXY);
    if (!Number.isFinite(lengthMeters)) continue;
    reachableEdgeCount += 1;
    reachableLengthMeters += lengthMeters;
    const highway = input.wayHighway.get(edge.wayId) ?? UNKNOWN_HIGHWAY;
    const accumulator = byHighway.get(highway);
    if (accumulator === undefined) {
      byHighway.set(highway, { edgeCount: 1, lengthMeters });
    } else {
      accumulator.edgeCount += 1;
      accumulator.lengthMeters += lengthMeters;
    }
  }

  const byHighwayList = [...byHighway.entries()]
    .map(([highway, accumulator]) => ({
      highway,
      edgeCount: accumulator.edgeCount,
      lengthMeters: accumulator.lengthMeters,
      lengthShare: reachableLengthMeters > 0 ? accumulator.lengthMeters / reachableLengthMeters : 0,
    }))
    .sort((a, b) => b.lengthMeters - a.lengthMeters);

  return {
    originNode,
    budgetSeconds,
    mode,
    reachableNodeCount: best.size,
    reachableEdgeCount,
    reachableLengthMeters,
    byHighway: byHighwayList,
    truncated,
    profile: options?.profile ?? DEFAULT_WEIGHT_PROFILE,
    traffic:
      traffic === undefined
        ? null
        : {
            hourOfDay,
            congestionEnabled,
            appliedEventCount,
          },
  };
}

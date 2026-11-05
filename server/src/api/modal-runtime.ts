/**
 * 多模态运行时:按需构建指定交通模态的子图、禁转服务与道路 GeoJSON,并做容量受限缓存。
 *
 * 装载策略(2026-11-04,A 决策,实测数据见 docs/多模态路网设计.md):
 * 采用**方案 A 按需懒加载**。武汉实测单模态完整运行时(拓扑 + 禁转索引 + 禁转表)约占
 * 620 MB 堆,四模态全部常驻约 2.5 GB 堆 / 3.0 GB RSS,启动即占用远超作业四「启动 < 3s」
 * 与 8 GB 笔记本的内存预算,故否决方案 B(启动构建全部四份)。
 * 重运行时按 LRU 淘汰(默认同一时刻只驻留 1 个模态);道路 GeoJSON 序列化结果单独缓存
 * (每模态约 26 MB),使地图切换不必重建图。
 */
import type {
  RoadFeature,
  RoadFeatureCollection,
  TransferPoint,
  TravelMode,
  WayProperties,
} from '@gisalgo/shared';
import { Graph } from '../graph/index.js';
import { getTransferPoints, PersistentTurnService, type LoadedNetwork } from '../io/index.js';
import { buildModalTopology, type TopologyResult } from '../topology/index.js';

/** 服务端支持的交通模态,与 shared 的 TravelMode 取值一致。 */
export const TRAVEL_MODES: readonly TravelMode[] = ['car', 'walk', 'bike', 'bus'];

/** 判断查询参数是否为受支持的模态。 */
export function isTravelMode(value: unknown): value is TravelMode {
  return typeof value === 'string' && (TRAVEL_MODES as readonly string[]).includes(value);
}

/**
 * 单个模态的运行时产物。
 *
 * 图与 way→等级表**惰性构建**：只有路径查询才需要（62.8 万节点 / ~100 万边），
 * 转向读写只依赖拓扑与禁转服务，不应白白承担构造成本。
 */
export class ModalRuntime {
  private graphCache: Graph | null = null;
  private wayHighwayCache: ReadonlyMap<number, string> | null = null;

  constructor(
    readonly mode: TravelMode,
    /** 该模态独立构建的拓扑。边 ID 只在本模态内有效，不能跨模态复用。 */
    readonly topology: TopologyResult,
    /** 禁转门面：禁转表 + OSM 导入 + SQLite 持久化。 */
    readonly service: PersistentTurnService,
    /** 准入排除清单（等级 / 权限 / 方向）。 */
    readonly excludedWays: { wayId: number; reason: string }[],
  ) {}

  /** 该模态的图；首次访问才构建。 */
  get graph(): Graph {
    if (this.graphCache === null) {
      this.graphCache = new Graph(this.topology.nodes, this.topology.edges);
    }
    return this.graphCache;
  }

  /** 该模态的 wayId → highway 表，供里程/时间权重查表。 */
  get wayHighway(): ReadonlyMap<number, string> {
    if (this.wayHighwayCache === null) {
      this.wayHighwayCache = new Map(
        [...this.topology.ways].map(([wayId, way]) => [wayId, way.highway]),
      );
    }
    return this.wayHighwayCache;
  }
}

export interface ModalRuntimeOptions {
  /** SQLite 快照文件路径;实际数据集按模态区分。 */
  databasePath: string;
  /** 持久化数据集前缀,实际数据集为 `${dataset}:${mode}`。 */
  dataset: string;
  /** 同时驻留的重运行时个数,默认 1;调大可换取模态切换速度,代价是内存线性增长。 */
  capacity?: number;
}

/**
 * 多模态运行时的注册表。
 *
 * 派生数据缺少 Sprint2 字段(relations / transferPoints / nodeTags)时不做构建,
 * 由调用方读取 `unavailableReason` 返回 503,其余接口不受影响。
 */
export class ModalRuntimeRegistry {
  private readonly runtimes = new Map<TravelMode, ModalRuntime>();
  private readonly features = new Map<TravelMode, string>();
  private readonly capacity: number;

  constructor(
    private readonly network: LoadedNetwork,
    private readonly options: ModalRuntimeOptions,
  ) {
    this.capacity = Math.max(1, options.capacity ?? 1);
  }

  /** 派生数据是否包含 Sprint2 字段。 */
  get ready(): boolean {
    return this.network.dataWarnings.length === 0;
  }

  /** 不可用时的原因;可用时为 null。 */
  get unavailableReason(): string | null {
    return this.network.dataWarnings[0] ?? null;
  }

  /** 取指定模态的运行时;必要时构建,并按 LRU 淘汰旧模态。 */
  runtime(mode: TravelMode): ModalRuntime {
    const cached = this.runtimes.get(mode);
    if (cached !== undefined) {
      // 重新插入到队尾,实现 LRU:最近使用的模态最后被淘汰
      this.runtimes.delete(mode);
      this.runtimes.set(mode, cached);
      return cached;
    }
    const built = this.build(mode);
    this.runtimes.set(mode, built);
    while (this.runtimes.size > this.capacity) {
      const oldest = this.runtimes.keys().next();
      if (oldest.done === true) break;
      this.runtimes.delete(oldest.value);
    }
    return built;
  }

  /**
   * 指定模态的道路 GeoJSON(已序列化)。
   *
   * 与运行时缓存彼此独立:四个模态的序列化结果可同时保留(合计约 104 MB),
   * 地图切换不必重建图。运行时已缓存该模态时直接复用其拓扑,否则临时构建一次。
   */
  featuresJson(mode: TravelMode): string {
    const cached = this.features.get(mode);
    if (cached !== undefined) return cached;
    const runtime = this.runtimes.get(mode);
    const topology = runtime !== undefined ? runtime.topology : this.buildModalTopology(mode);
    const json = JSON.stringify(this.buildFeatures(topology));
    this.features.set(mode, json);
    return json;
  }

  /** 转换点(按模态筛选);直接来自派生文件,不依赖模态图。 */
  transferPoints(mode?: TravelMode): TransferPoint[] {
    return getTransferPoints(this.network.transferPoints, mode);
  }

  private buildModalTopology(mode: TravelMode): TopologyResult {
    if (!this.ready) throw new Error(this.unavailableReason ?? '派生数据缺少 Sprint2 字段');
    return buildModalTopology(this.network.nodes, this.network.ways, mode).topology;
  }

  private build(mode: TravelMode): ModalRuntime {
    if (!this.ready) throw new Error(this.unavailableReason ?? '派生数据缺少 Sprint2 字段');
    const modal = buildModalTopology(this.network.nodes, this.network.ways, mode);
    const service = new PersistentTurnService(modal.topology, {
      databasePath: this.options.databasePath,
      dataset: `${this.options.dataset}:${mode}`,
      mode,
      relations: this.network.relations,
    });
    return new ModalRuntime(mode, modal.topology, service, modal.excludedWays);
  }

  /**
   * 生成该模态的道路要素。
   *
   * 只保留**真正参与该模态有向图**的道路:准入通过且至少贡献一条有向边。
   * 方向未支持的道路虽通过准入,但不产生边,渲染出来会误导为可通行。
   */
  private buildFeatures(topology: TopologyResult): RoadFeatureCollection {
    const edgedWayIds = new Set<number>();
    for (const edge of topology.edges) edgedWayIds.add(edge.wayId);
    const features: RoadFeature[] = [];
    for (const way of this.network.ways) {
      if (!topology.ways.has(way.id) || !edgedWayIds.has(way.id)) continue;
      const coordinates: [number, number][] = [];
      for (const nodeId of way.nds) {
        const point = this.network.nodes.get(nodeId);
        if (point === undefined) continue;
        coordinates.push([point[1], point[0]]);
      }
      if (coordinates.length < 2) continue;
      const properties: WayProperties = { id: way.id, highway: way.highway, tags: way.tags };
      if (way.name !== undefined) properties.name = way.name;
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties,
      });
    }
    return { type: 'FeatureCollection', features };
  }
}

/** 创建多模态运行时注册表;跨模块只经本工厂获取,不直接 new。 */
export function createModalRuntimeRegistry(
  network: LoadedNetwork,
  options: ModalRuntimeOptions,
): ModalRuntimeRegistry {
  return new ModalRuntimeRegistry(network, options);
}

let activeRegistry: ModalRuntimeRegistry | null = null;
/**
 * 记录进程内唯一的多模态运行时。
 *
 * B 的路径搜索(issue #28)必须与 REST 层共用同一份禁转服务:编辑器保存的禁转
 * 立即改变路径结果,若各自持有实例则内存态会分叉(磁盘一致、内存不一致)。
 */
export function setActiveModalRuntimeRegistry(registry: ModalRuntimeRegistry): void {
  activeRegistry = registry;
}

/** 取进程内已初始化的多模态运行时;未初始化时抛错。 */
export function getActiveModalRuntimeRegistry(): ModalRuntimeRegistry {
  if (activeRegistry === null) throw new Error('多模态运行时尚未初始化');
  return activeRegistry;
}

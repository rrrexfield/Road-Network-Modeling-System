import type { WayProperties } from '@gisalgo/shared';

/** 压缩链需保留的原始属性；不推断限速或重新执行模式准入。 */
export interface CompressionWayAttributes {
  highway: string;
  tags: Readonly<Record<string, string>>;
}

const relevantTag = (key: string): boolean =>
  /^(maxspeed|oneway|access|foot|bicycle|vehicle|motor_vehicle|motorcar|bus|psv)(:|$)/.test(key);

/**
 * 为B的压缩链提供way属性只读查询和边界判定，不构图、不扫描邻居、不合并边。
 * @param ways 当前模式拓扑的原始道路属性；构造后使用属性快照，不受调用方修改影响。
 * @remarks 等级、限速、方向和权限任一原始值不同就断链；不把不同拼写猜作等价。
 * 名称不同本身不阻止压缩，原始wayId仍应由B的originalEdgeIds映射保留。
 * 方向连通性（例如同标签但行驶方向在节点处改变）仍由B按有向边检查。
 * 构造O(道路标签数)，查询和两way比较O(1)。不定义shared或API契约。
 */
export class CompressionWayIndex {
  private readonly attributes = new Map<number, CompressionWayAttributes>();
  private readonly signatures = new Map<number, string>();

  constructor(ways: ReadonlyMap<number, WayProperties>) {
    for (const [id, way] of ways) {
      const entries = Object.entries(way.tags)
        .filter(([key]) => relevantTag(key))
        .sort(([a], [b]) => a.localeCompare(b));
      this.attributes.set(
        id,
        Object.freeze({
          highway: way.highway,
          tags: Object.freeze(Object.fromEntries(entries)),
        }),
      );
      this.signatures.set(id, JSON.stringify([way.highway, entries]));
    }
  }

  /** 返回冻结的属性快照；未知way明确报错，不能被当作无差异而跨越。 */
  get(wayId: number): CompressionWayAttributes {
    const value = this.attributes.get(wayId);
    if (value === undefined) throw new Error(`压缩输入缺少道路属性: ${wayId}`);
    return value;
  }

  /** true表示两条原始道路的相关属性不同，此处必须保留链边界。 */
  hasBoundary(firstWayId: number, secondWayId: number): boolean {
    this.get(firstWayId);
    this.get(secondWayId);
    return this.signatures.get(firstWayId) !== this.signatures.get(secondWayId);
  }
}

export interface CompressionProtectedNodesInput {
  /** 当前禁转服务给出的via节点，包含人工设置；不是仅原始relations。 */
  turnViaNodeIds: Iterable<number>;
  /** A的实际换乘连接表中的fromNodeId/toNodeId，不是设施展示id。 */
  transferNodeIds: Iterable<number>;
}

/**
 * 合并语义保留节点供B使用，不重复判断邻居数、方向或属性边界。
 * @param nodes 当前模式图的节点表，只保留确实在本图中的节点。
 * @returns 新Set，不修改输入；O(输入保留节点数)。链端点由B按当前有向图自然保留。
 */
export function collectCompressionProtectedNodes(
  nodes: ReadonlyMap<number, unknown>,
  input: CompressionProtectedNodesInput,
): Set<number> {
  const result = new Set<number>();
  for (const ids of [input.turnViaNodeIds, input.transferNodeIds])
    for (const id of ids) if (nodes.has(id)) result.add(id);
  return result;
}

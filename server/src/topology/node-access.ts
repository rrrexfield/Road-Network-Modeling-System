import type { TravelMode } from '@gisalgo/shared';
import type { TopologyResult } from './build-topology.js';

export type NodeTags = ReadonlyMap<number, readonly { k: string; v: string }[]>;
export type NodeAccessDecision =
  | { checked: false; allowed: false; reason: 'node-tags-unavailable' }
  | { checked: true; allowed: true }
  | { checked: true; allowed: false; reason: string };
export interface NodeAccessReport {
  /** 未传标签输入时为false，兼容旧调用，不宣称校验过权限。 */
  checked: boolean;
  excludedNodes: { nodeId: number; reason: string }[];
  excludedEdgeCount: number;
}

export const accessKeys: Record<TravelMode, readonly string[]> = {
  car: ['motorcar', 'motor_vehicle', 'vehicle', 'access'],
  bus: ['bus', 'psv', 'motor_vehicle', 'vehicle', 'access'],
  bike: ['bicycle', 'vehicle', 'access'],
  walk: ['foot', 'access'],
};
const allowed = new Set(['yes', 'designated', 'permissive']);
// 此类屏障有明确模式许可时才认可；物理墙/未知屏障即使有yes也保留未决诊断。
const permissionBarriers = new Set([
  'gate',
  'lift_gate',
  'swing_gate',
  'cycle_barrier',
  'bollard',
  'block',
  'stile',
  'turnstile',
  'kissing_gate',
  'sally_port',
  'chain',
  'toll_booth',
  'entrance',
]);

function exclusion(tags: Record<string, string>, mode: TravelMode): string | undefined {
  const keys = accessKeys[mode];
  if (tags['barrier:conditional'] !== undefined) return 'conditional-node-barrier';
  if (keys.some((k) => tags[`${k}:conditional`] !== undefined)) return 'conditional-node-access';
  if (keys.some((k) => tags[`${k}:forward`] !== undefined || tags[`${k}:backward`] !== undefined))
    return 'directional-node-access';
  const value = keys.map((k) => tags[k]).find((v) => v !== undefined);
  if (value === 'no' || value === 'private') return 'node-access-denied';
  if (value === 'permit') return 'node-permit-required';
  if (value !== undefined && !allowed.has(value)) return `unsupported-node-access:${value}`;
  const barrier = tags.barrier;
  if (barrier !== undefined && barrier !== 'no') {
    if (!permissionBarriers.has(barrier)) return `unsupported-node-barrier:${barrier}`;
    if (value === undefined) return `node-barrier-permission-unresolved:${barrier}`;
  }
  return undefined;
}

/**
 * 对任意节点标签复用构图准入规则，不依赖节点是否已在图内，供设施自身权限检查。
 * undefined表示调用方无完整标签证据，拒绝当作已校验；[]只用于已确认没有标签的节点。
 * allowed仅表示当前保守规则没有排除，不证明入口、楼层、接驳路线或公众实景通行。
 * 模式层级、屏障与条件规则和buildModalTopology共用，不修改输入或创建连接。
 */
export function evaluateNodeAccess(
  tags: readonly { k: string; v: string }[] | undefined,
  mode: TravelMode,
): NodeAccessDecision {
  if (!Object.hasOwn(accessKeys, mode)) throw new Error(`未知交通模式: ${mode}`);
  if (tags === undefined)
    return { checked: false, allowed: false, reason: 'node-tags-unavailable' };
  const reason = exclusion(Object.fromEntries(tags.map((t) => [t.k, t.v])), mode);
  return reason === undefined
    ? { checked: true, allowed: true }
    : { checked: true, allowed: false, reason };
}

/**
 * 按模式检查已入图节点标签，移除受限节点的相邻有向段；不跨缺口补边。
 * 输入topology须是本次新建的结果，本函数只修改它，不修改原始节点/way/标签。
 * sparse标签表由调用方保证来自完整标签提取；缺少某节点条目表示无标签，整表缺失则checked=false。
 * 保留剩余edgeId与原始way属性；诊断只针对原本入图的节点，时间O(V+E+节点标签)。
 */
export function applyNodeAccess(
  topology: TopologyResult,
  mode: TravelMode,
  nodeTags?: NodeTags,
): NodeAccessReport {
  const report: NodeAccessReport = {
    checked: nodeTags !== undefined,
    excludedNodes: [],
    excludedEdgeCount: 0,
  };
  if (nodeTags === undefined) return report;
  const blocked = new Set<number>();
  for (const id of topology.nodes.keys()) {
    const entries = nodeTags.get(id);
    if (!entries?.length) continue;
    const decision = evaluateNodeAccess(entries, mode);
    if (!decision.allowed) {
      blocked.add(id);
      report.excludedNodes.push({ nodeId: id, reason: decision.reason });
    }
  }
  if (!blocked.size) return report;
  const before = topology.edges.length;
  topology.edges = topology.edges.filter((e) => !blocked.has(e.from) && !blocked.has(e.to));
  report.excludedEdgeCount = before - topology.edges.length;
  const used = new Set<number>();
  for (const e of topology.edges) {
    used.add(e.from);
    used.add(e.to);
  }
  for (const id of topology.nodes.keys()) if (!used.has(id)) topology.nodes.delete(id);
  return report;
}

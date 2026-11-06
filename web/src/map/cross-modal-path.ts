/**
 * 跨模态路径的纯逻辑：模态序列的增删与规范化、模态配色、
 * `PathSegment[]` → 绘制数据、状态栏摘要文案。
 *
 * 单独抽成纯函数是为了能脱离 DOM 与 deck.gl 单测这条链路——它是「跨模态路径」的前端半边：
 * 模态序列决定请求参数（`modes=car,walk`），服务端返回分段后由这里转成绘制数据。
 * 关闭跨模态时（本模块的入口都是可选入参）行为与单模态完全一致。
 */
import type { PathSegment, TravelMode } from '@gisalgo/shared';
import { travelModeLabel } from './mode-control-model.js';

/** 跨模态至少需要的模态数：少于 2 个视为未启用跨模态（与单模态行为一致）。 */
export const MIN_CROSS_MODAL_MODES = 2;

/**
 * 各模态的路径主色（RGBA）。
 * 金色沿用既有路径主色，步行/骑行/公交取既有主题内的语义色，不引入新的主色体系。
 */
export const MODE_COLORS: Record<TravelMode, [number, number, number, number]> = {
  car: [242, 198, 109, 255],
  walk: [127, 214, 160, 255],
  bike: [127, 199, 232, 255],
  bus: [232, 163, 92, 255],
};

/** 跨模态路径的一段（含绘制用的坐标与固定配色）。 */
export interface CrossModalSegmentPath {
  mode: TravelMode;
  coordinates: [number, number][];
  color: [number, number, number, number];
}

/** 换乘点标记（相邻两段的衔接处）。 */
export interface TransferMarker {
  position: [number, number];
  /** 转换点 id；服务端未给出时为 null。 */
  transferPointId: number | null;
}

/** 跨模态路径的绘制数据。 */
export interface CrossModalDrawData {
  segmentPaths: CrossModalSegmentPath[];
  transferMarkers: TransferMarker[];
}

/** 取模态的固定配色。 */
export function modeColor(mode: TravelMode): [number, number, number, number] {
  return MODE_COLORS[mode];
}

/** 规范化模态序列：去重并保持给定顺序。 */
export function normalizeModeSequence(modes: readonly TravelMode[]): TravelMode[] {
  const seen = new Set<TravelMode>();
  const result: TravelMode[] = [];
  for (const mode of modes) {
    if (seen.has(mode)) continue;
    seen.add(mode);
    result.push(mode);
  }
  return result;
}

/** 序列是否构成跨模态：规范化后长度至少 2。 */
export function isCrossModalSequence(modes: readonly TravelMode[]): boolean {
  return normalizeModeSequence(modes).length >= MIN_CROSS_MODAL_MODES;
}

/** 追加一个模态到序列末尾；已存在则保持原样（不重复、不改变顺序）。 */
export function addModeToSequence(sequence: readonly TravelMode[], mode: TravelMode): TravelMode[] {
  const normalized = normalizeModeSequence(sequence);
  if (normalized.includes(mode)) return normalized;
  return [...normalized, mode];
}

/** 从序列中移除一个模态，其余模态保持原有顺序。 */
export function removeModeFromSequence(
  sequence: readonly TravelMode[],
  mode: TravelMode,
): TravelMode[] {
  return normalizeModeSequence(sequence).filter((item) => item !== mode);
}

/**
 * 把服务端的分段结果转成绘制数据。
 *
 * 换乘点只有 id、没有坐标，故标记位置取**前段终点与后段起点坐标的中点**——
 * 两段共用同一个衔接点时中点即为该点本身。
 */
export function buildCrossModalDrawData(segments: readonly PathSegment[]): CrossModalDrawData {
  const segmentPaths: CrossModalSegmentPath[] = [];
  const transferMarkers: TransferMarker[] = [];

  segments.forEach((segment, index) => {
    if (segment.coordinates.length === 0) return;
    segmentPaths.push({
      mode: segment.mode,
      coordinates: segment.coordinates,
      color: modeColor(segment.mode),
    });

    const next = segments[index + 1];
    if (!next) return;
    const from = segment.coordinates[segment.coordinates.length - 1];
    const to = next.coordinates[0];
    if (!from || !to) return;
    transferMarkers.push({
      position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
      transferPointId: segment.toTransferPoint ?? next.fromTransferPoint ?? null,
    });
  });

  return { segmentPaths, transferMarkers };
}

/** 格式化单段（或总计）的代价：时间口径用时分，距离口径用 km/m。 */
export function formatSegmentCost(value: number, metric: 'distance' | 'time'): string {
  if (metric === 'time') {
    const minutes = value / 60;
    if (minutes < 60) return `${minutes.toFixed(1)} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes - hours * 60);
    return `${hours} 小时 ${rest} 分`;
  }
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
}

/**
 * 生成跨模态路径的状态栏摘要。
 *
 * 例：`汽车 1.2 km → 步行 0.8 km · 换乘 1 处 · 共 5.4 分钟`
 *
 * @param segments 服务端返回的分段。
 * @param metric 口径：time 用时分，distance 用 km/m。
 * @param transferPenaltySeconds 换乘罚时合计（秒）。按契约它**不计入** distance，
 *   故在时间口径下单独加到总计里，否则用户看到的耗时会少掉等待与接驳时间。
 */
export function formatCrossModalSummary(
  segments: readonly PathSegment[],
  metric: 'distance' | 'time',
  transferPenaltySeconds?: number,
): string {
  const parts = segments.map(
    (segment) => `${travelModeLabel(segment.mode)} ${formatSegmentCost(segment.distance, metric)}`,
  );
  const total = segments.reduce((sum, segment) => sum + segment.distance, 0);
  const transfers = Math.max(0, segments.length - 1);
  const penalty = transferPenaltySeconds ?? 0;
  const totalCost = metric === 'time' ? total + penalty : total;
  const penaltyText = metric === 'time' && penalty > 0 ? `（含换乘等待 ${formatSegmentCost(penalty, 'time')}）` : '';
  return `${parts.join(' → ')} · 换乘 ${transfers} 处 · 共 ${formatSegmentCost(totalCost, metric)}${penaltyText}`;
}
